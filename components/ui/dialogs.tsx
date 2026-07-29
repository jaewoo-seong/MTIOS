"use client";

import { useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n";

/** Confirmation for destructive or irreversible actions. */
export function ConfirmDialog({
  title, body, confirmLabel = "Confirm", destructive = false, busy = false, onConfirm, onCancel
}: {
  title: string;
  body: string;
  confirmLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  return (
    <Modal labelledBy={titleId} onClose={onCancel} className="dialog dialog-sm">
      <div className="dialog-head">
        <div>
          <span className="eyebrow">{t(destructive ? "Permanent" : "Confirm")}</span>
          <h2 id={titleId}>{title}</h2>
        </div>
      </div>
      <p className="confirm-body">{body}</p>
      <div className="dialog-actions">
        <button type="button" className="secondary" onClick={onCancel} disabled={busy}>{t("Cancel")}</button>
        <button
          type="button"
          className={destructive ? "primary danger" : "primary"}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy && <Loader2 size={13} className="spin" aria-hidden />}
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/** Single-field input, replacing window.prompt so it matches the rest of the UI. */
export function PromptDialog({
  title, label, placeholder, initialValue = "", submitLabel = "Create", onSubmit, onCancel
}: {
  title: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
  submitLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const [value, setValue] = useState(initialValue);

  return (
    <Modal labelledBy={titleId} onClose={onCancel} className="dialog dialog-sm" dismissOnBackdrop={false}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <div className="dialog-head">
          <h2 id={titleId}>{title}</h2>
        </div>
        <label className="field">
          {label}
          <input
            value={value}
            placeholder={placeholder}
            onChange={(event) => setValue(event.target.value)}
            required
          />
        </label>
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onCancel}>{t("Cancel")}</button>
          <button className="primary" disabled={!value.trim()}>{t(submitLabel)}</button>
        </div>
      </form>
    </Modal>
  );
}
