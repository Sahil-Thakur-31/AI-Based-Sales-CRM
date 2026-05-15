import { useEffect } from "react";
import "./SuccessPrompt.css";

export default function SuccessPrompt({
  open,
  title,
  subtitle = "",
  buttonText = "OK",
  autoCloseMs = 0,
  onClose
}) {
  useEffect(() => {
    if (!open || !autoCloseMs) return undefined;
    const timer = window.setTimeout(() => onClose?.(), autoCloseMs);
    return () => window.clearTimeout(timer);
  }, [autoCloseMs, onClose, open]);

  if (!open) return null;

  return (
    <div className="success-prompt-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="success-prompt-card">
        <div className="success-prompt-content">
          <div className="success-prompt-check">✓</div>
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
          <button type="button" onClick={onClose}>{buttonText}</button>
        </div>
      </div>
    </div>
  );
}
