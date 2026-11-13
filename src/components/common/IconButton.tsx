import type { ReactNode } from 'react';
import './IconButton.css';

export interface IconButtonProps {
  label: string;
  onClick: () => void;
  children: ReactNode;
  pressed?: boolean;
  disabled?: boolean;
  className?: string;
}

export function IconButton({ label, onClick, children, pressed, disabled, className }: IconButtonProps) {
  const cls = ['ss-icon-btn', className].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={cls}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
