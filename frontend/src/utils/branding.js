import API from "../api";

export const ORGANIZATION_BRAND_STORAGE_KEY = "organizationBranding";
export const ORGANIZATION_BRAND_UPDATED_EVENT = "organization-brand-updated";
export const DEFAULT_APP_NAME = "Sales CRM";

export function resolveAssetUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("blob:")) {
    return raw;
  }

  const normalized = raw.replace(/\\/g, "/");
  const base = String(API.defaults.baseURL || "").replace(/\/?$/, "/");

  try {
    return new URL(normalized, base).toString();
  } catch (_err) {
    return `${String(API.defaults.baseURL || "").replace(/\/$/, "")}${normalized.startsWith("/") ? "" : "/"}${normalized}`;
  }
}

export function normalizeOrganizationBrand(organization) {
  return {
    companyName: String(organization?.companyName || organization?.name || "").trim(),
    shortName: String(organization?.shortName || "").trim(),
    logoUrl: resolveAssetUrl(organization?.logoUrl || ""),
    iconUrl: resolveAssetUrl(organization?.iconUrl || "")
  };
}

export function getCachedOrganizationBrand() {
  try {
    const raw = localStorage.getItem(ORGANIZATION_BRAND_STORAGE_KEY);
    if (!raw) return normalizeOrganizationBrand(null);
    const parsed = JSON.parse(raw);
    return {
      companyName: String(parsed?.companyName || "").trim(),
      shortName: String(parsed?.shortName || "").trim(),
      logoUrl: String(parsed?.logoUrl || "").trim(),
      iconUrl: String(parsed?.iconUrl || "").trim()
    };
  } catch (_err) {
    return normalizeOrganizationBrand(null);
  }
}

export function persistOrganizationBrand(organization) {
  const normalized = normalizeOrganizationBrand(organization);
  try {
    localStorage.setItem(ORGANIZATION_BRAND_STORAGE_KEY, JSON.stringify(normalized));
  } catch (_err) {
    // Ignore storage failures and keep the in-memory brand usable.
  }
  return normalized;
}

export function notifyOrganizationBrandUpdated(organization) {
  const normalized = persistOrganizationBrand(organization);
  window.dispatchEvent(
    new CustomEvent(ORGANIZATION_BRAND_UPDATED_EVENT, {
      detail: normalized
    })
  );
  return normalized;
}

export function buildDocumentTitle(pageName, companyName) {
  const trimmedCompanyName = String(companyName || "").trim();
  return trimmedCompanyName ? `${trimmedCompanyName} - ${DEFAULT_APP_NAME}` : DEFAULT_APP_NAME;
}

export function setDocumentFavicon(iconUrl) {
  let favicon = document.querySelector("link[rel='icon']");
  if (!favicon) {
    favicon = document.createElement("link");
    favicon.setAttribute("rel", "icon");
    document.head.appendChild(favicon);
  }

  if (iconUrl) {
    favicon.setAttribute("href", iconUrl);
    return;
  }

  favicon.setAttribute(
    "href",
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"
  );
}
