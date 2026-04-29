const mongoose = require("mongoose");
const Event = require("../models/events");
const Industry = require("../models/industries");
const Location = require("../models/location");
const Source = require("../models/sources");

const parseDatabaseNameFromUri = (mongoUri = "") => {
  try {
    const parsed = new URL(mongoUri);
    return parsed.pathname.replace(/^\/+/, "").split("/")[0] || "";
  } catch {
    return "";
  }
};

const getScraperMongoUri = () =>
  process.env.SCRAPER_CONN || process.env.CONN || "mongodb://localhost:27017/event_intelligence";

const getScraperDbName = () =>
  process.env.SCRAPER_DB_NAME ||
  parseDatabaseNameFromUri(getScraperMongoUri()) ||
  "event_intelligence";

const getScraperCollectionName = () => process.env.SCRAPER_COLLECTION_NAME || "scraped_events";

const SCRAPER_SOURCE_META = {
  predicthq: { name: "PredictHQ", url: "https://www.predicthq.com/" },
  meetup: { name: "Meetup", url: "https://www.meetup.com/" },
  eventbrite: { name: "Eventbrite", url: "https://www.eventbrite.com/" },
  mccia: { name: "MCCIA", url: "https://mcciapune.com/" },
  nasscom: { name: "NASSCOM", url: "https://nasscom.in/" },
  mea: { name: "MEA", url: "https://www.meainternationalexpo.com/" },
};

const INDUSTRY_LOOKUP_TTL_MS = 10 * 60 * 1000;
const GENERIC_INDUSTRY_STOPWORDS = new Set([
  "and",
  "for",
  "the",
  "with",
  "from",
  "into",
  "your",
  "our",
  "this",
  "that",
  "summit",
  "conference",
  "expo",
  "events",
  "event",
  "industry",
  "technologies",
  "technology",
]);
const EVENT_TOKEN_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "your",
  "our",
  "this",
  "that",
  "event",
  "events",
  "expo",
  "conference",
  "summit",
  "workshop",
  "meetup",
  "online",
  "india",
  "in",
  "on",
  "at",
]);
const SEED_EVENT_DESCRIPTION_REGEX = /\[seed:/i;
const NON_SEED_EVENT_FILTER = { description: { $not: SEED_EVENT_DESCRIPTION_REGEX } };

const INDIA_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman and Nicobar Islands",
  "Andaman & Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
];

let scraperConnectionPromise = null;
let industryLookupCache = {
  expiresAt: 0,
  value: null,
};

function getScraperConnection() {
  if (!scraperConnectionPromise) {
    const connection = mongoose.createConnection(getScraperMongoUri(), {
      dbName: getScraperDbName(),
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 3,
    });
    scraperConnectionPromise = connection.asPromise().then(() => connection);
  }
  return scraperConnectionPromise;
}

async function getScrapedEventModel() {
  const connection = await getScraperConnection();
  return connection.models.ScrapedEvent || connection.model(
    "ScrapedEvent",
    new mongoose.Schema({}, { strict: false, collection: getScraperCollectionName() })
  );
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeComparableText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function buildIndustryKeywords(name, description) {
  const normalizedName = normalizeComparableText(name);
  const normalizedDescription = normalizeComparableText(description);
  const keywordCandidates = [normalizedName, ...normalizedName.split(" "), ...normalizedDescription.split(" ")];
  const keywords = [];
  const seen = new Set();
  for (const candidate of keywordCandidates) {
    const token = cleanText(candidate).toLowerCase();
    if (!token || seen.has(token)) continue;
    if (token.length < 3) continue;
    if (GENERIC_INDUSTRY_STOPWORDS.has(token)) continue;
    seen.add(token);
    keywords.push(token);
  }
  return keywords;
}

async function getIndustryLookup(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && industryLookupCache.value && industryLookupCache.expiresAt > now) {
    return industryLookupCache.value;
  }

  const rows = await Industry.find({ is_deleted: { $ne: true } })
    .select("_id name description")
    .lean();

  const entries = rows
    .map((row) => {
      const name = cleanText(row.name);
      if (!name) return null;
      return {
        id: String(row._id),
        name,
        normalizedName: normalizeComparableText(name),
        keywords: buildIndustryKeywords(name, row.description),
      };
    })
    .filter(Boolean);

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const byName = new Map(entries.map((entry) => [entry.normalizedName, entry]));
  const value = { entries, byId, byName };

  industryLookupCache = {
    value,
    expiresAt: now + INDUSTRY_LOOKUP_TTL_MS,
  };
  return value;
}

function normalizeWebsiteUrl(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.search = "";
    parsed.hash = "";
    const normalized = parsed.toString().replace(/\/+$/, "");
    return normalized;
  } catch {
    return raw.replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

function normalizeIdentityText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

function normalizeDateKey(value) {
  if (!value) return "";
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function buildExternalIdentityKey(scrapedEvent, sourceName = "") {
  const normalizedSource = normalizeIdentityText(sourceName || scrapedEvent.source || scrapedEvent?.scoreMeta?.source);
  const normalizedName = normalizeIdentityText(scrapedEvent.name);
  const normalizedDate = normalizeDateKey(scrapedEvent.startDate);
  const normalizedVenue = normalizeIdentityText(scrapedEvent.venue || scrapedEvent.address);
  if (!(normalizedSource && normalizedName && normalizedDate)) {
    return "";
  }
  return [normalizedSource, normalizedName, normalizedDate, normalizedVenue || "na"].join("|");
}

function buildLocationIdentity(scrapedEvent = {}) {
  const parsed = parseLocationParts(scrapedEvent);
  const city = normalizeIdentityText(parsed.city);
  const state = normalizeIdentityText(parsed.state);
  const venue = normalizeIdentityText(scrapedEvent.venue || scrapedEvent.address);
  return city || state
    ? [city || "na", state || "na"].join("|")
    : (venue || "na");
}

function buildDedupeSignature(scrapedEvent, sourceName = "") {
  const normalizedSource = normalizeIdentityText(sourceName || scrapedEvent.source || scrapedEvent?.scoreMeta?.source) || "na";
  const normalizedName = normalizeIdentityText(scrapedEvent.name);
  const normalizedDate = normalizeDateKey(scrapedEvent.startDate);
  const normalizedLocation = buildLocationIdentity(scrapedEvent);
  if (!(normalizedName && normalizedDate)) {
    return "";
  }
  return [normalizedSource, normalizedName, normalizedDate, normalizedLocation].join("|");
}

function buildDedupeSignatureFromEventDoc(eventDoc = {}) {
  const normalizedSource = normalizeIdentityText(eventDoc.source?.name || eventDoc.source || "na") || "na";
  const normalizedName = normalizeIdentityText(eventDoc.name);
  const normalizedDate = normalizeDateKey(eventDoc.startDate);
  if (!(normalizedName && normalizedDate)) return "";

  const city = normalizeIdentityText(eventDoc.location?.city);
  const state = normalizeIdentityText(eventDoc.location?.State || eventDoc.location?.state);
  const fallbackLocation = normalizeIdentityText(eventDoc.venue || eventDoc.address);
  const normalizedLocation = city || state
    ? [city || "na", state || "na"].join("|")
    : (fallbackLocation || "na");

  return [normalizedSource, normalizedName, normalizedDate, normalizedLocation].join("|");
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toRoiRangeLabel(roiValue) {
  if (!Number.isFinite(roiValue)) return "N/A";
  if (roiValue >= 2) return "Strong";
  if (roiValue >= 0.75) return "Moderate";
  if (roiValue >= 0) return "Low";
  return "Weak";
}

function normalizeRoiRoleComparison(rawComparison) {
  if (!rawComparison || typeof rawComparison !== "object") return null;
  const visitorRaw = rawComparison.Visitor || rawComparison.visitor || null;
  const exhibitorRaw = rawComparison.Exhibitor || rawComparison.exhibitor || null;
  const visitorPredicted = toOptionalNumber(visitorRaw?.predictedROI);
  const exhibitorPredicted = toOptionalNumber(exhibitorRaw?.predictedROI);
  if (visitorPredicted === null && exhibitorPredicted === null) return null;

  const recommendedRole = cleanText(rawComparison.recommendedRole);
  const decisionSummary = cleanText(rawComparison.decisionSummary);
  const inferredRole = cleanText(rawComparison.inferredRole);
  const buildRole = (roleName, prediction, fallback) => {
    if (prediction === null) return null;
    return {
      predictedROI: Number(prediction.toFixed(4)),
      expectedROIRange: cleanText(fallback?.expectedROIRange) || toRoiRangeLabel(prediction),
      confidence: clamp(toNumber(fallback?.confidence, 65), 0, 100),
      role: roleName,
    };
  };
  const visitor = buildRole("Visitor", visitorPredicted, visitorRaw);
  const exhibitor = buildRole("Exhibitor", exhibitorPredicted, exhibitorRaw);
  const inferredRecommendedRole = recommendedRole || (visitor && exhibitor
    ? (visitor.predictedROI >= exhibitor.predictedROI ? "Visitor" : "Exhibitor")
    : (visitor ? "Visitor" : "Exhibitor"));

  return {
    Visitor: visitor || {
      predictedROI: Number((toNumber(exhibitor?.predictedROI, 0) * 0.9).toFixed(4)),
      expectedROIRange: exhibitor?.expectedROIRange || "Moderate",
      confidence: clamp(toNumber(exhibitor?.confidence, 60) - 5, 0, 100),
      role: "Visitor",
    },
    Exhibitor: exhibitor || {
      predictedROI: Number((toNumber(visitor?.predictedROI, 0) * 0.9).toFixed(4)),
      expectedROIRange: visitor?.expectedROIRange || "Moderate",
      confidence: clamp(toNumber(visitor?.confidence, 60) - 5, 0, 100),
      role: "Exhibitor",
    },
    recommendedRole: inferredRecommendedRole,
    decisionSummary: decisionSummary || "Model-calculated from score, attendance, exhibitor density, fee and priority.",
    inferredRole: inferredRole || "Backend Model",
  };
}

function buildModelRoiPrediction({
  aiScore,
  attendeesCount,
  exhibitorsCount,
  registrationFee,
  priorityTag,
}) {
  const normalizedScore = clamp(toNumber(aiScore, 55), 0, 100);
  const attendees = Math.max(0, toNumber(attendeesCount, 0));
  const exhibitors = Math.max(0, toNumber(exhibitorsCount, 0));
  const fee = toOptionalNumber(registrationFee);

  const scoreFactor = (normalizedScore / 100) * 3.4;
  const attendeesFactor = clamp(Math.log10(attendees + 1) * 0.45, 0, 1.8);
  const exhibitorsFactor = clamp(Math.log10(exhibitors + 1) * 0.18, 0, 0.8);
  let feeFactor = 0;
  if (fee === null || fee === 0) feeFactor = 0.18;
  else if (fee > 0 && fee <= 1500) feeFactor = 0.1;
  else if (fee > 8000) feeFactor = -0.14;

  const normalizedPriority = cleanText(priorityTag).toLowerCase();
  const priorityFactor = normalizedPriority === "strategic"
    ? 0.22
    : normalizedPriority === "high"
      ? 0.15
      : 0;

  const visitorRoi = clamp(0.55 + scoreFactor + attendeesFactor + feeFactor + priorityFactor, -0.35, 8.5);
  const exhibitorRoi = clamp(visitorRoi * 0.84 + exhibitorsFactor - 0.08, -0.45, 7.6);
  const recommendedRole = visitorRoi >= exhibitorRoi ? "Visitor" : "Exhibitor";
  const signalCount =
    (toOptionalNumber(aiScore) !== null ? 1 : 0) +
    (toOptionalNumber(attendeesCount) !== null ? 1 : 0) +
    (toOptionalNumber(exhibitorsCount) !== null ? 1 : 0) +
    (toOptionalNumber(registrationFee) !== null ? 1 : 0);
  const confidence = clamp(42 + (signalCount * 13) + (normalizedScore >= 70 ? 8 : 0), 35, 90);
  const recommendedRoi = recommendedRole === "Visitor" ? visitorRoi : exhibitorRoi;

  return {
    predictedROI: Number(recommendedRoi.toFixed(4)),
    roiPredictionConfidence: confidence,
    expectedROIRange: toRoiRangeLabel(recommendedRoi),
    recommendedParticipationRole: recommendedRole,
    roiDecisionSummary: "Model-calculated from score, attendance, exhibitor density, fee and priority.",
    roiRoleComparison: {
      Visitor: {
        predictedROI: Number(visitorRoi.toFixed(4)),
        expectedROIRange: toRoiRangeLabel(visitorRoi),
        confidence,
        role: "Visitor",
      },
      Exhibitor: {
        predictedROI: Number(exhibitorRoi.toFixed(4)),
        expectedROIRange: toRoiRangeLabel(exhibitorRoi),
        confidence: Math.max(35, confidence - 4),
        role: "Exhibitor",
      },
      recommendedRole,
      decisionSummary: "Model-calculated from score, attendance, exhibitor density, fee and priority.",
      inferredRole: "Backend Model",
    },
  };
}

function normalizeSourceName(source) {
  const raw = cleanText(source).toLowerCase();
  if (!raw) return { name: "Scraper Import", url: "" };
  return SCRAPER_SOURCE_META[raw] || {
    name: raw.charAt(0).toUpperCase() + raw.slice(1),
    url: "",
  };
}

function buildSearchBlob(scrapedEvent) {
  return [
    scrapedEvent.name,
    scrapedEvent.description,
    ...(Array.isArray(scrapedEvent?.scoreMeta?.tags) ? scrapedEvent.scoreMeta.tags : []),
    ...(Array.isArray(scrapedEvent.tags) ? scrapedEvent.tags : []),
  ]
    .map((item) => cleanText(item))
    .filter(Boolean)
    .join(" ");
}

function inferIndustryName(scrapedEvent, industryLookup) {
  const lookup = industryLookup || { entries: [], byId: new Map(), byName: new Map() };
  const rawIndustry = cleanText(scrapedEvent.industry);
  if (rawIndustry) {
    const asTextId = String(rawIndustry);
    if (lookup.byId.has(asTextId)) {
      return lookup.byId.get(asTextId).name;
    }

    const normalizedRaw = normalizeComparableText(rawIndustry);
    if (normalizedRaw) {
      if (lookup.byName.has(normalizedRaw)) {
        return lookup.byName.get(normalizedRaw).name;
      }

      const fuzzyByName = lookup.entries.find((entry) =>
        normalizedRaw.includes(entry.normalizedName) ||
        entry.normalizedName.includes(normalizedRaw)
      );
      if (fuzzyByName) return fuzzyByName.name;
    }
  }

  const blob = normalizeComparableText(buildSearchBlob(scrapedEvent));
  if (!blob) return null;

  let bestMatch = null;
  let bestScore = 0;
  for (const entry of lookup.entries) {
    let score = 0;
    if (entry.normalizedName && blob.includes(entry.normalizedName)) {
      score += 4;
    }
    for (const keyword of entry.keywords || []) {
      if (blob.includes(keyword)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  }

  if (bestMatch && bestScore >= 2) {
    return bestMatch.name;
  }

  if (rawIndustry && !mongoose.Types.ObjectId.isValid(rawIndustry)) {
    return rawIndustry;
  }
  return null;
}

function getFinalScore(scrapedEvent) {
  return toNumber(scrapedEvent?.scoreMeta?.finalScore ?? scrapedEvent?.finalScore, 0);
}

function shouldSyncScrapedEvent(scrapedEvent, minimumScore, industryLookup, inferredIndustryName = "") {
  const finalScore = getFinalScore(scrapedEvent);
  if (finalScore < minimumScore) {
    return false;
  }
  return Boolean(cleanText(inferredIndustryName) || inferIndustryName(scrapedEvent, industryLookup));
}

function parseLocationParts(scrapedEvent) {
  const venue = cleanText(scrapedEvent.venue);
  const address = cleanText(scrapedEvent.address);
  const joined = [venue, address].filter(Boolean).join(", ");
  const compact = joined.replace(/\s+/g, " ").trim();

  let city = "";
  let state = "";
  let country = "";

  const indiaPattern = /(?:^|,\s*)([^,]+?)(?:\s*-\s*\d{5,6})?,\s*([^,]+),\s*(India)\b/i;
  const indiaMatch = compact.match(indiaPattern);
  if (indiaMatch) {
    city = cleanText(indiaMatch[1]);
    state = cleanText(indiaMatch[2]);
    country = "India";
  }

  if (!city || !state) {
    const venueParts = venue.split(",").map((part) => cleanText(part)).filter(Boolean);
    if (venueParts.length >= 2) {
      city = city || venueParts[0];
      state = state || venueParts[1];
    }
  }

  if (!state) {
    const lowered = compact.toLowerCase();
    const matchedState = INDIA_STATES.find((item) => lowered.includes(item.toLowerCase()));
    if (matchedState) state = matchedState;
  }

  if (!country && compact.toLowerCase().includes("india")) {
    country = "India";
  }

  city = city.replace(/\s*-\s*\d{5,6}\s*$/, "").trim();

  return { city, state, country };
}

function tokenizeEventText(value) {
  const text = normalizeComparableText(value);
  if (!text) return [];
  return text
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !EVENT_TOKEN_STOPWORDS.has(token));
}

function uniqueTokens(tokens = []) {
  const seen = new Set();
  const cleaned = [];
  for (const token of tokens) {
    const normalized = cleanText(token).toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    cleaned.push(normalized);
  }
  return cleaned;
}

function buildEventFeatureTokens(scrapedEvent = {}, context = {}) {
  const locationParts = context.locationParts || parseLocationParts(scrapedEvent);
  const chunks = [
    scrapedEvent.name,
    scrapedEvent.description,
    scrapedEvent.venue,
    scrapedEvent.address,
    locationParts.city,
    locationParts.state,
    locationParts.country,
    context.industryName || scrapedEvent.industry,
    context.sourceName || scrapedEvent.source,
    ...(Array.isArray(scrapedEvent?.tags) ? scrapedEvent.tags : []),
    ...(Array.isArray(scrapedEvent?.scoreMeta?.tags) ? scrapedEvent.scoreMeta.tags : []),
  ];

  const tokens = chunks.flatMap((item) => tokenizeEventText(item));
  return uniqueTokens(tokens);
}

function deriveEngagementLabel(eventDoc = {}, startOfToday = new Date()) {
  const attendedCount = Array.isArray(eventDoc.attendedBy) ? eventDoc.attendedBy.length : 0;
  const registeredLegacy = Array.isArray(eventDoc.registeredBy) ? eventDoc.registeredBy.length : 0;
  const registrationRows = Array.isArray(eventDoc.registrations) ? eventDoc.registrations.length : 0;
  if (attendedCount > 0 || registeredLegacy > 0 || registrationRows > 0) return "positive";

  const eventEnd = eventDoc.endDate ? new Date(eventDoc.endDate) : (eventDoc.startDate ? new Date(eventDoc.startDate) : null);
  const isPast = Boolean(eventEnd && !Number.isNaN(eventEnd.getTime()) && eventEnd < startOfToday);
  return isPast ? "negative" : "neutral";
}

function computeTokenModelScore(tokens = [], snapshot = null) {
  if (!snapshot?.trained) return null;
  const tokenList = uniqueTokens(tokens);
  if (!tokenList.length) return null;

  const posEvents = Math.max(1, snapshot.positiveEventCount);
  const negEvents = Math.max(1, snapshot.negativeEventCount);
  let logOddsSum = 0;

  for (const token of tokenList) {
    const posCount = snapshot.positiveTokenCounts.get(token) || 0;
    const negCount = snapshot.negativeTokenCounts.get(token) || 0;
    const posProb = (posCount + 1) / (posEvents + 2);
    const negProb = (negCount + 1) / (negEvents + 2);
    logOddsSum += Math.log(posProb / negProb);
  }

  const avgLogOdds = logOddsSum / tokenList.length;
  const probability = 1 / (1 + Math.exp(-avgLogOdds * 1.25));
  return clamp(Math.round(probability * 100), 0, 100);
}

function blendAiScores(ruleScore, tokenScore) {
  const baseRuleScore = clamp(toNumber(ruleScore, 0), 0, 100);
  if (tokenScore === null || tokenScore === undefined) return baseRuleScore;
  const tokenComponent = clamp(toNumber(tokenScore, 0), 0, 100);
  return clamp(Math.round((baseRuleScore * 0.58) + (tokenComponent * 0.42)), 0, 100);
}

function jaccardScore(tokensA = [], tokensB = []) {
  if (!tokensA.length || !tokensB.length) return 0;
  const left = new Set(tokensA);
  const right = new Set(tokensB);
  let intersection = 0;
  left.forEach((item) => {
    if (right.has(item)) intersection += 1;
  });
  const union = left.size + right.size - intersection;
  if (!union) return 0;
  return intersection / union;
}

function predictRoiFromHistoricalBatch({ tokens, industryName, locationParts }, snapshot) {
  if (!snapshot?.trained || !Array.isArray(snapshot.roiCandidates) || !snapshot.roiCandidates.length) {
    return null;
  }

  const normalizedIndustry = normalizeComparableText(industryName);
  const normalizedCity = normalizeComparableText(locationParts?.city);
  const normalizedState = normalizeComparableText(locationParts?.state);
  const scored = [];

  for (const candidate of snapshot.roiCandidates) {
    let score = 0;
    if (normalizedIndustry && candidate.normalizedIndustry && candidate.normalizedIndustry === normalizedIndustry) score += 3;
    if (normalizedCity && candidate.normalizedCity && candidate.normalizedCity === normalizedCity) score += 1.5;
    if (normalizedState && candidate.normalizedState && candidate.normalizedState === normalizedState) score += 1.1;
    score += jaccardScore(tokens, candidate.tokens) * 4.2;
    if (score < 1.6) continue;
    scored.push({ candidate, score });
  }

  if (!scored.length) return null;
  scored.sort((left, right) => right.score - left.score);
  const topMatches = scored.slice(0, 10);

  let totalWeight = 0;
  let weightedVisitor = 0;
  let weightedExhibitor = 0;
  let weightedMean = 0;
  for (const row of topMatches) {
    const weight = row.score;
    totalWeight += weight;
    weightedVisitor += row.candidate.visitorRoi * weight;
    weightedExhibitor += row.candidate.exhibitorRoi * weight;
    weightedMean += row.candidate.referenceRoi * weight;
  }
  if (!totalWeight) return null;

  const visitorRoi = Number((weightedVisitor / totalWeight).toFixed(4));
  const exhibitorRoi = Number((weightedExhibitor / totalWeight).toFixed(4));
  const meanRoi = Number((weightedMean / totalWeight).toFixed(4));
  const recommendedRole = visitorRoi >= exhibitorRoi ? "Visitor" : "Exhibitor";
  const recommendedRoi = recommendedRole === "Visitor" ? visitorRoi : exhibitorRoi;
  const confidence = clamp(Math.round(48 + (topMatches.length * 4) + (Math.min(1, totalWeight / (topMatches.length * 5)) * 20)), 40, 92);

  return {
    predictedROI: recommendedRoi,
    roiPredictionConfidence: confidence,
    expectedROIRange: toRoiRangeLabel(recommendedRoi),
    recommendedParticipationRole: recommendedRole,
    roiDecisionSummary: `Predicted from ${topMatches.length} similar historical events (industry/location/token overlap).`,
    roiRoleComparison: {
      Visitor: {
        predictedROI: visitorRoi,
        expectedROIRange: toRoiRangeLabel(visitorRoi),
        confidence,
        role: "Visitor",
      },
      Exhibitor: {
        predictedROI: exhibitorRoi,
        expectedROIRange: toRoiRangeLabel(exhibitorRoi),
        confidence: Math.max(35, confidence - 4),
        role: "Exhibitor",
      },
      recommendedRole,
      decisionSummary: `Predicted from ${topMatches.length} similar historical events (industry/location/token overlap).`,
      inferredRole: "Historical Similarity",
    },
    sampleSize: topMatches.length,
    meanRoi,
    roiModelSource: "historical_batch_mean",
  };
}

function buildTokensFromExistingEvent(eventDoc = {}) {
  if (Array.isArray(eventDoc.featureTokens) && eventDoc.featureTokens.length) {
    return uniqueTokens(eventDoc.featureTokens);
  }
  const locationParts = {
    city: cleanText(eventDoc.location?.city),
    state: cleanText(eventDoc.location?.State || eventDoc.location?.state),
    country: cleanText(eventDoc.location?.country),
  };
  return buildEventFeatureTokens(eventDoc, {
    industryName: cleanText(eventDoc.industry?.name || eventDoc.industryName || ""),
    sourceName: cleanText(eventDoc.source?.name || ""),
    locationParts,
  });
}

async function buildHistoricalLearningSnapshot() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const pastFilter = {
    is_deleted: { $ne: true },
    $or: [
      { endDate: { $lt: startOfToday } },
      { endDate: null, startDate: { $lt: startOfToday } },
    ],
  };

  const rows = await Event.find(pastFilter)
    .select("name description venue address location industry source startDate endDate featureTokens attendedBy registeredBy registrations predictedROI roiRoleComparison realizedROI")
    .populate("industry", "name")
    .populate("location", "city State state country")
    .populate("source", "name")
    .lean();

  const positiveTokenCounts = new Map();
  const negativeTokenCounts = new Map();
  const roiCandidates = [];
  let positiveEventCount = 0;
  let negativeEventCount = 0;

  for (const row of rows) {
    const tokens = buildTokensFromExistingEvent(row);
    const engagement = deriveEngagementLabel(row, startOfToday);
    const tokenSet = new Set(tokens);
    if (engagement === "positive") {
      positiveEventCount += 1;
      tokenSet.forEach((token) => {
        positiveTokenCounts.set(token, (positiveTokenCounts.get(token) || 0) + 1);
      });
    } else if (engagement === "negative") {
      negativeEventCount += 1;
      tokenSet.forEach((token) => {
        negativeTokenCounts.set(token, (negativeTokenCounts.get(token) || 0) + 1);
      });
    }

    const baseRoi = toOptionalNumber(row.realizedROI) ?? toOptionalNumber(row.predictedROI);
    if (baseRoi === null) continue;
    const comparison = normalizeRoiRoleComparison(row.roiRoleComparison);
    const visitorRoi = toOptionalNumber(comparison?.Visitor?.predictedROI) ?? baseRoi;
    const exhibitorRoi = toOptionalNumber(comparison?.Exhibitor?.predictedROI) ?? Number((baseRoi * 0.9).toFixed(4));
    roiCandidates.push({
      tokens,
      normalizedIndustry: normalizeComparableText(row.industry?.name || ""),
      normalizedCity: normalizeComparableText(row.location?.city || ""),
      normalizedState: normalizeComparableText(row.location?.State || row.location?.state || ""),
      referenceRoi: baseRoi,
      visitorRoi,
      exhibitorRoi,
    });
  }

  return {
    trained: rows.length > 0,
    positiveTokenCounts,
    negativeTokenCounts,
    positiveEventCount,
    negativeEventCount,
    roiCandidates,
  };
}

async function ensureIndustry(industryName) {
  const normalized = cleanText(industryName);
  if (!normalized) return null;

  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let industry = await Industry.findOne({
    is_deleted: { $ne: true },
    name: { $regex: `^${escaped}$`, $options: "i" },
  }).select("_id name");

  if (!industry) {
    industry = await Industry.create({
      name: normalized,
      description: `Imported from scraper sync on ${new Date().toISOString()}`,
    });
  }

  return industry._id;
}

async function ensureSource(sourceName, sourceUrl) {
  const normalized = cleanText(sourceName);
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let source = await Source.findOne({
    is_deleted: { $ne: true },
    name: { $regex: `^${escaped}$`, $options: "i" },
  }).select("_id");

  if (!source) {
    source = await Source.create({
      name: normalized,
      url: cleanText(sourceUrl),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  return source._id;
}

async function resolveLocationId(scrapedEvent) {
  const { city, state, country } = parseLocationParts(scrapedEvent);
  if (!city) return null;

  const cityRegex = new RegExp(`^${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  const filters = [
    { city: cityRegex },
    { "city": cityRegex, State: state ? new RegExp(`^${state.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") : undefined },
    { "city": cityRegex, state: state ? new RegExp(`^${state.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") : undefined },
  ]
    .map((item) => Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined)));

  if (country) {
    filters.unshift({
      city: cityRegex,
      country: new RegExp(`^${country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
      ...(state ? { State: new RegExp(`^${state.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") } : {}),
    });
  }

  for (const filter of filters) {
    const location = await Location.findOne(filter).select("_id");
    if (location?._id) return location._id;
  }

  return null;
}

function buildUpdatePayload(scrapedEvent, industryId, sourceId, locationId, sourceName = "", learningSignals = null) {
  const scoreMeta = scrapedEvent.scoreMeta || {};
  const finalScore = toNumber(scoreMeta.finalScore ?? scrapedEvent.finalScore, 0);
  const ruleEngineScore = toOptionalNumber(learningSignals?.ruleEngineScore);
  const tokenSimilarityScore = toOptionalNumber(learningSignals?.tokenSimilarityScore);
  const blendedAiScore = toOptionalNumber(learningSignals?.blendedAiScore);
  const featureTokens = Array.isArray(learningSignals?.featureTokens)
    ? uniqueTokens(learningSignals.featureTokens)
    : [];
  const status = cleanText(scrapedEvent.status).toLowerCase() || "upcoming";
  const aiRecommendation = cleanText(
    scrapedEvent.aiRecommendation ||
    scoreMeta.aiRecommendation ||
    ""
  );
  const externalIdentityKey = buildExternalIdentityKey(scrapedEvent, sourceName);
  const dedupeSignature = buildDedupeSignature(scrapedEvent, sourceName);
  const registrationFee = toOptionalNumber(scrapedEvent.registrationFee);
  const attendeesCount = toOptionalNumber(scrapedEvent.attendeesCount);
  const exhibitorsCount = toOptionalNumber(scrapedEvent.exhibitorsCount);
  const latitude = toOptionalNumber(scrapedEvent.latitude ?? scoreMeta.latitude);
  const longitude = toOptionalNumber(scrapedEvent.longitude ?? scoreMeta.longitude);
  const providedRoleComparison = normalizeRoiRoleComparison(
    scrapedEvent.roiRoleComparison ||
    scoreMeta.roiRoleComparison ||
    scrapedEvent?.roiPredictionBreakdown?.rolePredictions ||
    scoreMeta?.roiPrediction?.rolePredictions ||
    null
  );
  const providedPredictedROI = toOptionalNumber(scrapedEvent.predictedROI) ?? toOptionalNumber(scoreMeta.predictedROI);
  const providedRoiConfidence = clamp(
    toNumber(scrapedEvent.roiPredictionConfidence ?? scoreMeta.roiPredictionConfidence, 0),
    0,
    100
  );
  const providedExpectedRange = cleanText(
    scrapedEvent.expectedROIRange ||
    scoreMeta.expectedROIRange ||
    ""
  );
  const providedRecommendedRole = cleanText(
    scrapedEvent.recommendedParticipationRole ||
    scoreMeta.recommendedParticipationRole ||
    scrapedEvent?.roiPredictionBreakdown?.recommendedRole ||
    scoreMeta?.roiPrediction?.recommendedRole ||
    ""
  );
  const providedDecisionSummary = cleanText(
    scrapedEvent.roiDecisionSummary ||
    scoreMeta.roiDecisionSummary ||
    scrapedEvent?.roiPredictionBreakdown?.decisionSummary ||
    scoreMeta?.roiPrediction?.decisionSummary ||
    ""
  );
  const historicalPrediction = learningSignals?.historicalRoiPrediction || null;
  const historicalRoleComparison = normalizeRoiRoleComparison(historicalPrediction?.roiRoleComparison || null);
  const historicalPredictedRoi = toOptionalNumber(historicalPrediction?.predictedROI);
  const historicalConfidence = toOptionalNumber(historicalPrediction?.roiPredictionConfidence);
  const historicalExpectedRange = cleanText(historicalPrediction?.expectedROIRange);
  const historicalRecommendedRole = cleanText(historicalPrediction?.recommendedParticipationRole);
  const historicalDecisionSummary = cleanText(historicalPrediction?.roiDecisionSummary);
  const historicalModelSource = cleanText(historicalPrediction?.roiModelSource || "historical_batch_mean");
  const historicalSampleSize = toNumber(historicalPrediction?.sampleSize, 0);
  const historicalMeanRoi = toOptionalNumber(historicalPrediction?.meanRoi);

  const modelPrediction = buildModelRoiPrediction({
    aiScore: blendedAiScore ?? finalScore,
    attendeesCount,
    exhibitorsCount,
    registrationFee,
    priorityTag: cleanText(scrapedEvent.priorityTag).toLowerCase() || "low",
  });
  const chosenRoleComparison = historicalRoleComparison || providedRoleComparison || modelPrediction.roiRoleComparison;
  const chosenRecommendedRole =
    historicalRecommendedRole ||
    providedRecommendedRole ||
    cleanText(chosenRoleComparison?.recommendedRole) ||
    modelPrediction.recommendedParticipationRole;
  const chosenPredictedROI = historicalPredictedRoi
    ?? providedPredictedROI
    ?? toOptionalNumber(chosenRoleComparison?.[chosenRecommendedRole]?.predictedROI)
    ?? modelPrediction.predictedROI;
  const chosenRoiConfidence = historicalConfidence
    ?? (providedRoiConfidence > 0
      ? providedRoiConfidence
      : toNumber(chosenRoleComparison?.[chosenRecommendedRole]?.confidence, modelPrediction.roiPredictionConfidence));
  const chosenExpectedRange = historicalExpectedRange
    || providedExpectedRange
    || cleanText(chosenRoleComparison?.[chosenRecommendedRole]?.expectedROIRange)
    || modelPrediction.expectedROIRange;
  const chosenDecisionSummary = historicalDecisionSummary
    || providedDecisionSummary
    || cleanText(chosenRoleComparison?.decisionSummary)
    || modelPrediction.roiDecisionSummary;
  const roiModelSource = historicalPredictedRoi !== null
    ? historicalModelSource
    : (providedPredictedROI !== null || providedRoleComparison ? "scraper" : "rule_fallback");

  return {
    name: cleanText(scrapedEvent.name),
    industry: industryId,
    venue: cleanText(scrapedEvent.venue),
    address: cleanText(scrapedEvent.address),
    location: locationId || undefined,
    startDate: scrapedEvent.startDate ? new Date(scrapedEvent.startDate) : null,
    endDate: scrapedEvent.endDate ? new Date(scrapedEvent.endDate) : (scrapedEvent.startDate ? new Date(scrapedEvent.startDate) : null),
    registrationFee: registrationFee === null ? null : Math.max(0, registrationFee),
    registrationCurrency: cleanText(scrapedEvent.registrationCurrency || "").toUpperCase(),
    attendeesCount: attendeesCount === null ? null : Math.max(0, attendeesCount),
    exhibitorsCount: exhibitorsCount === null ? null : Math.max(0, exhibitorsCount),
    latitude,
    longitude,
    featureTokens,
    ruleEngineScore: ruleEngineScore ?? Math.max(0, Math.min(100, finalScore)),
    tokenSimilarityScore,
    blendedAiScore: blendedAiScore ?? Math.max(0, Math.min(100, finalScore)),
    aiRelevanceScore: Math.max(0, Math.min(100, blendedAiScore ?? finalScore)),
    aiRecommendation,
    source: sourceId || undefined,
    expectedROIRange: chosenExpectedRange,
    predictedROI: chosenPredictedROI,
    roiPredictionConfidence: clamp(chosenRoiConfidence, 0, 100),
    recommendedParticipationRole: chosenRecommendedRole || modelPrediction.recommendedParticipationRole,
    roiDecisionSummary: chosenDecisionSummary,
    roiRoleComparison: chosenRoleComparison,
    roiModelSource,
    roiHistorySampleSize: historicalSampleSize,
    roiHistoryMean: historicalMeanRoi,
    engagementLabel: cleanText(learningSignals?.engagementLabel || "neutral") || "neutral",
    priorityTag: ["high", "medium", "low", "strategic"].includes(cleanText(scrapedEvent.priorityTag).toLowerCase())
      ? cleanText(scrapedEvent.priorityTag).toLowerCase()
      : "low",
    status: status === "completed" ? "completed" : "upcoming",
    websiteUrl: "",
    normalizedWebsiteUrl: "",
    externalIdentityKey,
    dedupeSignature,
    description: cleanText(scrapedEvent.description),
    is_deleted: false,
  };
}

function buildLookup(scrapedEvent, sourceId, sourceName = "") {
  const websiteUrl = cleanText(scrapedEvent.websiteUrl);
  const normalizedWebsiteUrl = normalizeWebsiteUrl(
    scrapedEvent.normalizedWebsiteUrl ||
    scrapedEvent?.scoreMeta?.normalizedWebsiteUrl ||
    websiteUrl
  );
  const externalIdentityKey = buildExternalIdentityKey(scrapedEvent, sourceName);
  const dedupeSignature = buildDedupeSignature(scrapedEvent, sourceName);
  const normalizedSourceId = sourceId ? new mongoose.Types.ObjectId(sourceId) : null;
  const matchers = [];
  if (externalIdentityKey) {
    matchers.push({ externalIdentityKey });
  }
  if (dedupeSignature) {
    if (normalizedSourceId) {
      matchers.push({ dedupeSignature, source: normalizedSourceId });
      matchers.push({ dedupeSignature, source: null });
    }
    matchers.push({ dedupeSignature });
  }
  if (normalizedWebsiteUrl) {
    const filters = [
      { normalizedWebsiteUrl },
      { websiteUrl: normalizedWebsiteUrl },
    ];
    if (websiteUrl && websiteUrl !== normalizedWebsiteUrl) {
      filters.push({ websiteUrl });
    }
    if (normalizedSourceId) {
      matchers.push(
        ...filters.map((filter) => ({ ...filter, source: normalizedSourceId })),
        ...filters.map((filter) => ({ ...filter, source: null })),
      );
    }
    matchers.push(...filters);
  }
  if (matchers.length) {
    return { $or: matchers };
  }

  const name = cleanText(scrapedEvent.name);
  const venue = cleanText(scrapedEvent.venue);
  const startDate = scrapedEvent.startDate ? new Date(scrapedEvent.startDate) : null;
  if (!(name && startDate)) {
    return null;
  }
  return { name, startDate, venue };
}

function scoreExistingEvent(existing = {}) {
  const aiScore = toNumber(existing.aiRelevanceScore, 0);
  const hasRoleComparison = existing?.roiRoleComparison ? 1 : 0;
  const hasPredictedRoi = toOptionalNumber(existing?.predictedROI) !== null ? 1 : 0;
  const registrations = Array.isArray(existing.registrations) ? existing.registrations.length : 0;
  const attendedBy = Array.isArray(existing.attendedBy) ? existing.attendedBy.length : 0;
  const interested = Array.isArray(existing.interested) ? existing.interested.length : 0;
  const updatedAt = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
  return (
    (hasRoleComparison * 8000000000000) +
    (hasPredictedRoi * 4000000000000) +
    (aiScore * 1000) +
    (registrations * 100) +
    (attendedBy * 50) +
    (interested * 20) +
    updatedAt
  );
}

function shouldBackfillRoi(eventDoc = {}) {
  if (toOptionalNumber(eventDoc.predictedROI) === null) return true;
  const comparison = normalizeRoiRoleComparison(eventDoc.roiRoleComparison);
  if (!comparison) return true;
  return false;
}

function buildRoiBackfillPayload(eventDoc = {}) {
  const comparison = normalizeRoiRoleComparison(eventDoc.roiRoleComparison);
  if (comparison) {
    const recommendedRole = cleanText(eventDoc.recommendedParticipationRole) || comparison.recommendedRole;
    const predictedRoi = toOptionalNumber(eventDoc.predictedROI)
      ?? toOptionalNumber(comparison?.[recommendedRole]?.predictedROI)
      ?? toOptionalNumber(comparison?.Visitor?.predictedROI)
      ?? toOptionalNumber(comparison?.Exhibitor?.predictedROI);
    const confidence = clamp(
      toNumber(eventDoc.roiPredictionConfidence, toNumber(comparison?.[recommendedRole]?.confidence, 68)),
      0,
      100
    );
    const expectedRange = cleanText(eventDoc.expectedROIRange)
      || cleanText(comparison?.[recommendedRole]?.expectedROIRange)
      || toRoiRangeLabel(toNumber(predictedRoi, 0));
    return {
      predictedROI: predictedRoi,
      roiPredictionConfidence: confidence,
      expectedROIRange: expectedRange,
      recommendedParticipationRole: recommendedRole || "Visitor",
      roiDecisionSummary: cleanText(eventDoc.roiDecisionSummary) || cleanText(comparison.decisionSummary),
      roiRoleComparison: comparison,
    };
  }

  return buildModelRoiPrediction({
    aiScore: toNumber(eventDoc.aiRelevanceScore, 55),
    attendeesCount: toOptionalNumber(eventDoc.attendeesCount),
    exhibitorsCount: toOptionalNumber(eventDoc.exhibitorsCount),
    registrationFee: toOptionalNumber(eventDoc.registrationFee),
    priorityTag: cleanText(eventDoc.priorityTag).toLowerCase() || "low",
  });
}

async function backfillEventRoiInDatabase() {
  const cursor = Event.find({ is_deleted: { $ne: true } })
    .select("_id aiRelevanceScore attendeesCount exhibitorsCount registrationFee priorityTag predictedROI roiPredictionConfidence expectedROIRange recommendedParticipationRole roiDecisionSummary roiRoleComparison")
    .lean()
    .cursor();

  let backfilled = 0;
  for await (const eventDoc of cursor) {
    if (!shouldBackfillRoi(eventDoc)) continue;
    const roiPayload = buildRoiBackfillPayload(eventDoc);
    await Event.updateOne(
      { _id: eventDoc._id },
      {
        $set: {
          predictedROI: roiPayload.predictedROI,
          roiPredictionConfidence: roiPayload.roiPredictionConfidence,
          expectedROIRange: roiPayload.expectedROIRange,
          recommendedParticipationRole: roiPayload.recommendedParticipationRole,
          roiDecisionSummary: roiPayload.roiDecisionSummary,
          roiRoleComparison: roiPayload.roiRoleComparison,
          updatedAt: new Date(),
        },
      }
    );
    backfilled += 1;
  }
  return backfilled;
}

async function collapseDuplicateEvents(primaryEvent) {
  if (SEED_EVENT_DESCRIPTION_REGEX.test(cleanText(primaryEvent?.description))) {
    return 0;
  }
  const externalIdentityKey = cleanText(primaryEvent?.externalIdentityKey);
  const dedupeSignature = cleanText(primaryEvent?.dedupeSignature);
  const normalizedWebsiteUrl = normalizeWebsiteUrl(primaryEvent?.normalizedWebsiteUrl || primaryEvent?.websiteUrl);
  const baseFilter = {
    ...NON_SEED_EVENT_FILTER,
    is_deleted: { $ne: true },
    _id: { $ne: primaryEvent._id },
  };
  const duplicateFilter = externalIdentityKey
    ? { ...baseFilter, externalIdentityKey }
    : dedupeSignature
    ? { ...baseFilter, dedupeSignature }
    : normalizedWebsiteUrl
    ? { ...baseFilter, normalizedWebsiteUrl }
    : {
      ...baseFilter,
      name: cleanText(primaryEvent.name),
      venue: cleanText(primaryEvent.venue),
      startDate: primaryEvent.startDate,
      source: primaryEvent.source || null,
    };

  const duplicates = await Event.find(duplicateFilter)
    .select("_id externalIdentityKey aiRelevanceScore registrations attendedBy interested updatedAt description")
    .lean();
  if (!duplicates.length) {
    return 0;
  }

  const allCandidates = [primaryEvent, ...duplicates];
  const winner = allCandidates.reduce((best, current) =>
    (scoreExistingEvent(current) > scoreExistingEvent(best) ? current : best)
  );
  const loserIds = allCandidates
    .filter((item) => String(item._id) !== String(winner._id))
    .map((item) => item._id);

  if (!loserIds.length) {
    return 0;
  }

  await Event.updateMany(
    { _id: { $in: loserIds } },
    {
      $set: {
        is_deleted: true,
        updatedAt: new Date(),
      },
    }
  );
  return loserIds.length;
}

async function collapseDuplicateGroupsByField(fieldName) {
  const groups = await Event.aggregate([
    {
      $match: {
        ...NON_SEED_EVENT_FILTER,
        is_deleted: { $ne: true },
        [fieldName]: { $exists: true, $nin: ["", null] },
      },
    },
    {
      $group: {
        _id: `$${fieldName}`,
        ids: { $push: "$_id" },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);
  if (!groups.length) return 0;

  let dedupedCount = 0;
  for (const group of groups) {
    const candidates = await Event.find({
      _id: { $in: group.ids },
      ...NON_SEED_EVENT_FILTER,
      is_deleted: { $ne: true },
    })
      .select("_id aiRelevanceScore registrations attendedBy interested updatedAt description")
      .lean();
    if (candidates.length <= 1) continue;

    const winner = candidates.reduce((best, current) =>
      (scoreExistingEvent(current) > scoreExistingEvent(best) ? current : best)
    );
    const loserIds = candidates
      .filter((item) => String(item._id) !== String(winner._id))
      .map((item) => item._id);
    if (!loserIds.length) continue;

    await Event.updateMany(
      { _id: { $in: loserIds } },
      {
        $set: {
          is_deleted: true,
          updatedAt: new Date(),
        },
      }
    );
    dedupedCount += loserIds.length;
  }
  return dedupedCount;
}

async function collapseGlobalDuplicates() {
  let total = 0;
  total += await collapseDuplicateGroupsByField("externalIdentityKey");
  total += await collapseDuplicateGroupsByField("dedupeSignature");
  total += await collapseDuplicateGroupsByField("normalizedWebsiteUrl");
  return total;
}

async function backfillEventDedupeSignaturesInDatabase() {
  const cursor = Event.find({
    ...NON_SEED_EVENT_FILTER,
    is_deleted: { $ne: true },
    $or: [
      { dedupeSignature: { $exists: false } },
      { dedupeSignature: "" },
      { dedupeSignature: null },
    ],
  })
    .select("_id source name startDate venue address location dedupeSignature")
    .populate("location", "city State state")
    .lean()
    .cursor();

  let backfilled = 0;
  for await (const eventDoc of cursor) {
    const dedupeSignature = buildDedupeSignatureFromEventDoc(eventDoc);
    if (!dedupeSignature) continue;
    await Event.updateOne(
      { _id: eventDoc._id },
      {
        $set: {
          dedupeSignature,
          updatedAt: new Date(),
        },
      }
    );
    backfilled += 1;
  }
  return backfilled;
}

async function syncScrapedEvents(options = {}) {
  const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : 200;
  const minimumScore = Number.isFinite(Number(options.minimumScore)) ? Number(options.minimumScore) : 50;
  const requestedSources = Array.isArray(options.sources)
    ? options.sources.map((item) => cleanText(item).toLowerCase()).filter(Boolean)
    : [];
  const ScrapedEvent = await getScrapedEventModel();

  const query = {
    is_deleted: { $ne: true },
    status: { $ne: "completed" },
    startDate: { $ne: null },
  };
  if (requestedSources.length) {
    query.$or = [
      { source: { $in: requestedSources } },
      { "scoreMeta.source": { $in: requestedSources } },
    ];
  }

  let scrapeQuery = ScrapedEvent.find(query)
    .sort({ updatedAt: -1, startDate: 1 });

  if (limit > 0) {
    scrapeQuery = scrapeQuery.limit(limit);
  }

  const scrapedEvents = await scrapeQuery.lean();

  const result = {
    discoveredCount: scrapedEvents.length,
    importedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    dedupedCount: 0,
    errors: [],
  };
  result.dedupeSignatureBackfilledCount = await backfillEventDedupeSignaturesInDatabase();
  result.dedupedCount += await collapseGlobalDuplicates();
  const industryLookup = await getIndustryLookup();
  const historicalLearningSnapshot = await buildHistoricalLearningSnapshot();

  for (const scrapedEvent of scrapedEvents) {
    try {
      const inferredIndustryName = inferIndustryName(scrapedEvent, industryLookup);
      if (!cleanText(scrapedEvent.name) || !scrapedEvent.startDate || !shouldSyncScrapedEvent(scrapedEvent, minimumScore, industryLookup, inferredIndustryName)) {
        result.skippedCount += 1;
        continue;
      }

      const industryId = await ensureIndustry(inferredIndustryName);
      if (!industryId) {
        result.skippedCount += 1;
        continue;
      }

      const sourceMeta = normalizeSourceName(scrapedEvent.source || scrapedEvent?.scoreMeta?.source);
      const sourceId = await ensureSource(sourceMeta.name, sourceMeta.url);
      const lookup = buildLookup(scrapedEvent, sourceId, sourceMeta.name);
      if (!lookup) {
        result.skippedCount += 1;
        continue;
      }

      const locationParts = parseLocationParts(scrapedEvent);
      const featureTokens = buildEventFeatureTokens(scrapedEvent, {
        industryName: inferredIndustryName,
        sourceName: sourceMeta.name,
        locationParts,
      });
      const ruleEngineScore = clamp(getFinalScore(scrapedEvent), 0, 100);
      const tokenSimilarityScore = computeTokenModelScore(featureTokens, historicalLearningSnapshot);
      const blendedAiScore = blendAiScores(ruleEngineScore, tokenSimilarityScore);
      const historicalRoiPrediction = predictRoiFromHistoricalBatch(
        {
          tokens: featureTokens,
          industryName: inferredIndustryName,
          locationParts,
        },
        historicalLearningSnapshot
      );

      const learningSignals = {
        featureTokens,
        ruleEngineScore,
        tokenSimilarityScore,
        blendedAiScore,
        historicalRoiPrediction,
        engagementLabel: "neutral",
      };

      const locationId = await resolveLocationId(scrapedEvent);
      const updateData = buildUpdatePayload(scrapedEvent, industryId, sourceId, locationId, sourceMeta.name, learningSignals);

      const existing = await Event.findOne(lookup)
        .select("_id source externalIdentityKey dedupeSignature normalizedWebsiteUrl websiteUrl name venue startDate aiRelevanceScore registrations attendedBy interested updatedAt");
      if (existing) {
        await Event.updateOne({ _id: existing._id }, { $set: updateData });
        const refreshed = await Event.findById(existing._id)
          .select("_id source externalIdentityKey dedupeSignature normalizedWebsiteUrl websiteUrl name venue startDate aiRelevanceScore registrations attendedBy interested updatedAt")
          .lean();
        const deduped = refreshed ? await collapseDuplicateEvents(refreshed) : 0;
        result.dedupedCount += deduped;
        result.updatedCount += 1;
      } else {
        const created = await Event.create(updateData);
        const deduped = await collapseDuplicateEvents(
          created.toObject
            ? created.toObject()
            : { _id: created._id, ...updateData }
        );
        result.dedupedCount += deduped;
        result.importedCount += 1;
      }
    } catch (error) {
      result.errors.push({
        name: cleanText(scrapedEvent?.name),
        websiteUrl: cleanText(scrapedEvent?.websiteUrl),
        error: error.message || String(error),
      });
    }
  }

  result.roiBackfilledCount = await backfillEventRoiInDatabase();

  return result;
}

module.exports = {
  syncScrapedEvents,
  backfillEventRoiInDatabase,
};
