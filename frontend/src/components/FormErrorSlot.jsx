import React from "react";

export default function FormErrorSlot({ message = "", className = "", centered = false }) {
  const cls = ["form-error-slot", centered ? "form-error-slot-center" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={cls} role="alert" aria-live="polite">
      {message || "\u00A0"}
    </span>
  );
}

