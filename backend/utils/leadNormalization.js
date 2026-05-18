function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toTitleCase(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeIndustry(value) {
  const text = clean(value);
  if (!text) return "";

  const lower = text.toLowerCase();
  const keywordMap = [
    { label: "Pharma", patterns: ["pharma", "pharmaceutical", "lifescience", "lifesciences", "life science", "biotech"] },
    { label: "Electronics", patterns: ["electronic", "electronics", "electronica", "electromech", "electrical"] },
    { label: "Solar", patterns: ["solar", "renewable energy", "renewables", "photovoltaic", "pv system"] },
    { label: "Real Estate", patterns: ["real estate"] },
    { label: "Construction", patterns: ["construction", "builder", "builders"] },
    { label: "Manufacturing", patterns: ["manufacturer", "manufacturing", "industrial"] },
    { label: "Engineering", patterns: ["engineering"] },
    { label: "Automotive", patterns: ["automobile", "automotive", "auto parts"] },
    { label: "IT", patterns: ["software", "information technology", " it ", "technology"] },
    { label: "Logistics", patterns: ["logistics", "transport", "warehouse"] },
    { label: "Finance", patterns: ["finance", "financial", "banking"] },
    { label: "Healthcare", patterns: ["healthcare", "hospital", "medical"] },
    { label: "Education", patterns: ["education", " edu ", "school", "college", "edtech"] },
    { label: "Retail", patterns: ["retail", "ecommerce", "e-commerce"] },
  ];

  const paddedLower = ` ${lower} `;
  const match = keywordMap.find((entry) =>
    entry.patterns.some((pattern) => paddedLower.includes(pattern))
  );
  if (match) return match.label;

  const stripped = text
    .replace(/\b(private|pvt\.?|limited|ltd\.?|company|companies|franchise|services?)\b/gi, "")
    .replace(/\bin\b.+$/i, "")
    .replace(/[&|/,-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = stripped.split(" ").filter(Boolean).slice(0, 3);
  return toTitleCase(words.join(" ") || text);
}

function normalizeEmail(value) {
  const raw = clean(value);
  if (!raw) return "";

  try {
    return decodeURIComponent(raw).trim().toLowerCase();
  } catch (err) {
    return raw.replace(/%20/gi, "").trim().toLowerCase();
  }
}

module.exports = {
  normalizeEmail,
  normalizeIndustry,
};
