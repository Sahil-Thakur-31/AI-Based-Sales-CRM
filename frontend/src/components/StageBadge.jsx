import React from "react";
import { getStageMeta } from "../utils/stages";
import "./StageBadge.css";

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

export default function StageBadge({
  stage,
  bucket,
  className = "",
  compact = false,
  fallback = "-",
}) {
  const meta = getStageMeta(stage, { bucket });
  if (!meta) {
    return <span className={cx("crm-stage-badge", "crm-stage-badge--default", className)}>{fallback}</span>;
  }

  return (
    <span
      className={cx(
        "crm-stage-badge",
        `crm-stage-theme--${meta.theme}`,
        `crm-stage-badge--${meta.tone}`,
        compact && "crm-stage-badge--compact",
        className
      )}
      title={meta.title}
    >
      {meta.title}
    </span>
  );
}

export function StageCard({
  stage,
  bucket,
  count,
  subtitle,
  active = false,
  compact = false,
  className = "",
  onClick,
}) {
  const meta = getStageMeta(stage, { bucket });
  if (!meta) return null;

  const sharedClassName = cx(
    "crm-stage-card",
    `crm-stage-theme--${meta.theme}`,
    `crm-stage-badge--${meta.tone}`,
    active && "crm-stage-card--active",
    compact && "crm-stage-card--compact",
    className
  );

  const body = (
    <>
      <div className="crm-stage-card__title">{meta.title}</div>
      {typeof count === "number" ? <div className="crm-stage-card__count">{count}</div> : null}
      <div className="crm-stage-card__sub">{subtitle || meta.subtitle}</div>
    </>
  );

  if (typeof onClick === "function") {
    return (
      <button type="button" className={sharedClassName} onClick={onClick} title={meta.title}>
        {body}
      </button>
    );
  }

  return (
    <div className={sharedClassName} title={meta.title}>
      {body}
    </div>
  );
}
