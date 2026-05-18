import { useEffect } from "react";
import "./SuccessPrompt.css";

export default function SuccessPrompt({
  open,
  title,
  subtitle = "",
  buttonText = "OK",
  cancelText = "Cancel",
  autoCloseMs = 0,
  mode = "success",
  confirmVariant = "success",
  onConfirm,
  onClose
}) {
  useEffect(() => {
    if (!open || !autoCloseMs || mode === "confirm") return undefined;
    const timer = window.setTimeout(() => onClose?.(), autoCloseMs);
    return () => window.clearTimeout(timer);
  }, [autoCloseMs, mode, onClose, open]);

  if (!open) return null;

  const isConfirm = mode === "confirm";

  return (
    <div className="success-prompt-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`success-prompt-card ${isConfirm ? "success-prompt-confirm" : ""} ${confirmVariant}`}>
        <div className="success-prompt-content">
          <div className="success-prompt-check">{isConfirm ? "!" : "✓"}</div>
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
          {isConfirm ? (
            <div className="success-prompt-actions">
              <button type="button" className="success-prompt-cancel" onClick={onClose}>
                {cancelText}
              </button>
              <button type="button" onClick={onConfirm}>
                {buttonText}
              </button>
            </div>
          ) : (
            <button type="button" onClick={onClose}>{buttonText}</button>
          )}
        </div>
      </div>
    </div>
  );
}
