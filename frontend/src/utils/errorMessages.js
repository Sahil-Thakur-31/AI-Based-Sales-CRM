const FIELD_LABELS = {
  source: "source",
  referred_by_user: "reference user",
  expo_event_id: "event or expo",
  assigned_to: "assigned user",
  industry: "industry",
  location: "location",
  company_name: "company name",
  deal_name: "deal name",
  email: "email",
  phone: "phone number",
  name: "name",
};

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function prettifyFieldName(fieldName = "") {
  const normalized = String(fieldName || "").trim();
  if (!normalized) return "field";
  if (FIELD_LABELS[normalized]) return FIELD_LABELS[normalized];
  return normalized.replace(/_/g, " ").trim().toLowerCase();
}

function joinFieldLabels(labels = []) {
  const uniqueLabels = [...new Set(
    (Array.isArray(labels) ? labels : [])
      .map((label) => prettifyFieldName(label))
      .filter(Boolean)
  )];

  if (!uniqueLabels.length) return "";
  if (uniqueLabels.length === 1) return uniqueLabels[0];
  if (uniqueLabels.length === 2) return `${uniqueLabels[0]} and ${uniqueLabels[1]}`;
  return `${uniqueLabels.slice(0, -1).join(", ")}, and ${uniqueLabels[uniqueLabels.length - 1]}`;
}

export function buildRequiredSelectionMessage(labels = []) {
  const joined = joinFieldLabels(labels);
  return joined ? `Please select ${joined}.` : "Please select the required fields.";
}

function buildObjectIdMessage(fieldName = "") {
  const label = prettifyFieldName(fieldName);
  if (["source", "reference user", "event or expo", "assigned user", "industry", "location"].includes(label)) {
    return `Please select a valid ${label}.`;
  }
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} is invalid. Please check it and try again.`;
}

export function looksTechnicalErrorMessage(message) {
  const text = normalizeWhitespace(message).toLowerCase();
  if (!text) return false;

  return [
    "validation failed",
    "cast to objectid failed",
    "bsonerror",
    "mongodb",
    "mongoose",
    "stack:",
    "cannot read properties of",
    "duplicate key error",
    "e11000",
  ].some((token) => text.includes(token));
}

export function humanizeErrorMessage(message, fallback = "Something went wrong. Please try again.") {
  const raw = normalizeWhitespace(message);
  if (!raw) return fallback;

  const castMatches = [...raw.matchAll(/path ["']([^"'`]+)["']/gi)];
  if (/cast to objectid failed/i.test(raw) && castMatches.length) {
    const fieldNames = [...new Set(castMatches.map((match) => String(match[1] || "").trim()).filter(Boolean))];
    if (fieldNames.length > 1) {
      return buildRequiredSelectionMessage(fieldNames);
    }
    return buildObjectIdMessage(fieldNames[0]);
  }

  const requiredMatch = raw.match(/Path [`"']([^`"']+)[`"'] is required/i);
  if (requiredMatch) {
    const label = prettifyFieldName(requiredMatch[1]);
    return `${label.charAt(0).toUpperCase()}${label.slice(1)} is required.`;
  }

  const duplicateMatch = raw.match(/duplicate key error.*index:\s*([a-z0-9_]+)/i);
  if (duplicateMatch) {
    const label = prettifyFieldName(duplicateMatch[1]);
    return `A record with this ${label} already exists.`;
  }

  if (/validation failed/i.test(raw)) {
    const invalidFieldNames = [...new Set(
      [...raw.matchAll(/([a-zA-Z_]+):\s*Cast to ObjectId failed[^,]*/gi)]
        .map((match) => String(match[1] || "").trim())
        .filter(Boolean)
    )];
    if (invalidFieldNames.length > 1) {
      return buildRequiredSelectionMessage(invalidFieldNames);
    }
    if (invalidFieldNames.length === 1) {
      return buildObjectIdMessage(invalidFieldNames[0]);
    }
    return "Some form values are invalid. Please check the highlighted fields and try again.";
  }

  if (/cannot read properties of undefined|cannot read property/i.test(raw)) {
    return "Something is missing in the form data. Please refresh and try again.";
  }

  if (/network error|failed to fetch|load failed/i.test(raw)) {
    return "Could not connect to the server. Please check your connection and try again.";
  }

  return raw;
}

export function getReadableErrorMessage(error, fallback = "Something went wrong. Please try again.") {
  const responseMessage = error?.response?.data?.message;
  const responseMsg = error?.response?.data?.msg;
  const responseError = error?.response?.data?.error;
  const directMessage = error?.message;

  const rawMessage =
    (typeof responseMessage === "string" && responseMessage) ||
    (typeof responseMsg === "string" && responseMsg) ||
    (typeof responseError === "string" && responseError) ||
    (typeof directMessage === "string" && directMessage) ||
    "";

  return humanizeErrorMessage(rawMessage, fallback);
}
