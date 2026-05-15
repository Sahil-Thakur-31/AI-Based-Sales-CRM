import { useEffect, useState } from "react";
import API from "../api";
import {
  getCachedOrganizationBrand,
  normalizeOrganizationBrand,
  notifyOrganizationBrandUpdated
} from "../utils/branding";

function AuthBrandHeader() {
  const [brand, setBrand] = useState(() => getCachedOrganizationBrand());

  useEffect(() => {
    let active = true;

    const loadBrand = async () => {
      try {
        const res = await API.get("/organizations/public-brand");
        if (!active) return;
        const nextBrand = notifyOrganizationBrandUpdated(res.data?.organization || null);
        setBrand(normalizeOrganizationBrand(nextBrand));
      } catch (_err) {
        if (!active) return;
        setBrand(getCachedOrganizationBrand());
      }
    };

    loadBrand();

    return () => {
      active = false;
    };
  }, []);

  if (!brand.logoUrl && !brand.companyName) {
    return null;
  }

  return (
    <div className="auth-brand-header">
      {brand.logoUrl ? (
        <img
          className="auth-brand-logo"
          src={brand.logoUrl}
          alt={brand.companyName ? `${brand.companyName} logo` : "Company logo"}
        />
      ) : (
        <div className="auth-brand-name">{brand.companyName}</div>
      )}
    </div>
  );
}

export default AuthBrandHeader;
