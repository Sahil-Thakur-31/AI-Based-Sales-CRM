import { routeConfig } from "../config/routeConfig";

function toPathRegex(pathPattern = "") {
  const escaped = String(pathPattern)
    .split("/")
    .map((segment) => {
      if (!segment) return "";
      if (segment.startsWith(":")) return "[^/]+";
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");

  return new RegExp(`^${escaped}$`);
}

export function getPageTitle(pathname = "", search = "") {
  const currentPath = String(pathname || "");
  const query = new URLSearchParams(search);

  if (currentPath === "/leads/new") {
    return query.get("view") === "deal" ? "Add Deal" : "Add Lead";
  }

  if (currentPath.startsWith("/leads/")) {
    return query.get("view") === "deal" ? "Deal Details" : "Lead Details";
  }

  const exactRoute = routeConfig.find((route) => currentPath === route.path);
  if (exactRoute) return exactRoute.title;

  const dynamicRoute = [...routeConfig]
    .filter((route) => route.dynamic)
    .sort((a, b) => b.path.length - a.path.length)
    .find((route) => toPathRegex(route.path).test(currentPath));

  return dynamicRoute?.title || "Dashboard";
}
