import { GearIcon, LogoIcon } from '@/components/common/icons';
import { IconButton } from '@/components/common/IconButton';
import { useStore } from '@/lib/createStore';
import { setSettingsOpen, setView, uiStore } from '@/state/ui';
import type { View } from '@/types';
import './Header.css';

const NAV: { view: View; label: string }[] = [
  { view: 'explore', label: 'Explore' },
  { view: 'favorites', label: 'Favorites' },
  { view: 'history', label: 'History' },
];

export function Header() {
  const view = useStore(uiStore, (s) => s.view);
  return (
    <header className="ss-header">
      <div className="ss-header__brand">
        <LogoIcon className="ss-header__logo" size={28} />
        <span className="ss-header__wordmark">SignalSurf</span>
      </div>
      <span className="ss-header__divider" aria-hidden="true" />
      <nav aria-label="Primary" className="ss-header__nav">
        {NAV.map((item) => {
          const active = view === item.view;
          return (
            <button
              key={item.view}
              type="button"
              className="ss-header__tab"
              aria-current={active ? 'page' : undefined}
              onClick={() => setView(item.view)}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
      <div className="ss-header__actions">
        <IconButton label="Settings" onClick={() => setSettingsOpen(true)}>
          <GearIcon size={20} />
        </IconButton>
      </div>
    </header>
  );
}
