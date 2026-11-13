import { useState } from 'react';
import './views.css';

export interface ConfirmClearButtonProps {
  idleLabel: string;
  disabled?: boolean;
  onConfirm: () => void;
}

/** A clear button that asks for an inline confirmation. No window.confirm. */
export function ConfirmClearButton({ idleLabel, disabled, onConfirm }: ConfirmClearButtonProps) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button type="button" className="ss-btn" disabled={disabled} onClick={() => setConfirming(true)}>
        {idleLabel}
      </button>
    );
  }

  return (
    <span className="ss-confirm">
      <span className="ss-confirm__text">Clear all?</span>
      <button
        type="button"
        className="ss-btn ss-btn--danger"
        onClick={() => {
          setConfirming(false);
          onConfirm();
        }}
      >
        Yes
      </button>
      <button type="button" className="ss-btn" autoFocus onClick={() => setConfirming(false)}>
        Cancel
      </button>
    </span>
  );
}
