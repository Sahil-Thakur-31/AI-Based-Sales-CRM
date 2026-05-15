const STAGE_ORDER = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"];
const DEAL_STAGE_KEYS = new Set(["P1", "P2", "P3", "P6", "P7"]);

const BASE_STAGE_META = {
  P1: {
    title: "Quote Sent",
    subtitle: "Awaiting response",
    theme: "p1",
    tone: "light",
  },
  P2: {
    title: "Meeting Scheduled",
    subtitle: "Upcoming meetings",
    theme: "p2",
    tone: "light",
  },
  P3: {
    title: "Fresh Leads",
    subtitle: "When we create new leads",
    theme: "p3",
    tone: "light",
  },
  P4: {
    title: "No Service",
    subtitle: "Service unavailable",
    theme: "p4",
    tone: "light",
  },
  P5: {
    title: "RNR",
    subtitle: "Right Now Right",
    theme: "p5",
    tone: "dark",
  },
  P6: {
    title: "No Response",
    subtitle: "Follow-up needed",
    theme: "p6",
    tone: "light",
  },
  P7: {
    title: "Lead Convert to Deal",
    subtitle: "Converted leads",
    theme: "p7",
    tone: "light",
  },
};

const BUCKET_OVERRIDES = {
  deal: {
    P3: {
      title: "Fresh Deals",
      subtitle: "New deals and converted leads",
    },
    P7: {
      title: "Won",
      subtitle: "Deal closed",
    },
  },
};

export function normalizeStageKey(stage) {
  return String(stage || "").trim().toUpperCase();
}

export function getStageMeta(stage, options = {}) {
  const key = normalizeStageKey(stage);
  if (!key) return null;

  const bucket = String(options.bucket || "").trim().toLowerCase();
  const baseMeta = BASE_STAGE_META[key];
  if (!baseMeta) {
    return {
      key,
      code: key,
      title: key,
      shortTitle: key,
      subtitle: "",
      theme: "default",
      tone: "light",
    };
  }

  const override = BUCKET_OVERRIDES[bucket]?.[key] || {};
  const shortTitle = override.title || baseMeta.title;

  return {
    key,
    code: key,
    title: `${key} - ${shortTitle}`,
    shortTitle,
    subtitle: override.subtitle || baseMeta.subtitle,
    theme: baseMeta.theme,
    tone: baseMeta.tone,
  };
}

export function getStageTitle(stage, options = {}) {
  return getStageMeta(stage, options)?.title || normalizeStageKey(stage) || "-";
}

export function buildStageOptions(bucket = "lead") {
  const normalizedBucket = String(bucket || "lead").trim().toLowerCase();
  const keys =
    normalizedBucket === "deal"
      ? STAGE_ORDER.filter((key) => DEAL_STAGE_KEYS.has(key))
      : STAGE_ORDER;
  return keys.map((key) => getStageMeta(key, { bucket: normalizedBucket }));
}

export const LEAD_STAGE_OPTIONS = buildStageOptions("lead");
export const DEAL_STAGE_OPTIONS = buildStageOptions("deal");
export const ALL_STAGE_OPTIONS = LEAD_STAGE_OPTIONS;
