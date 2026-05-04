import React from "react";
import "./ConfirmDialog.css";

const ConfirmDialog = ({
  isOpen,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  isWarning = false,
  hideCancel = false,
  disableConfirm = false,
  children = null
}) => {
  if (!isOpen) return null;

  return (
    <div className="confirm-dialog-overlay">
      <div className={`confirm-dialog ${isWarning ? "warning" : ""}`}>
        <div className="confirm-dialog-header">
          <h3>{title}</h3>
          <button className="close-btn" onClick={onCancel}>✕</button>
        </div>

        <div className="confirm-dialog-body">
          <p>{message}</p>
          {children}
        </div>

        <div className="confirm-dialog-footer">
          {!hideCancel && (
            <button className="btn-cancel" onClick={onCancel}>
              {cancelText}
            </button>
          )}
          <button
            className={`btn-confirm ${isWarning ? "warning" : ""}`}
            onClick={onConfirm}
            disabled={disableConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
