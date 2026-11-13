import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import { player } from '@/audio/player';
import { CloseIcon } from '@/components/common/icons';
import { IconButton } from '@/components/common/IconButton';
import { ConfirmClearButton } from '@/components/views/ConfirmClearButton';
import { useStore } from '@/lib/createStore';
import { storageAvailable } from '@/lib/safeStorage';
import { setSettingsOpen, uiStore } from '@/state/ui';
import { favorites, useFavorites } from '@/storage/favorites';
import { history, useHistory } from '@/storage/history';
import { storageHealth } from '@/storage/persisted';
import { settings, useSettings } from '@/storage/settings';
import './SettingsDialog.css';

export function SettingsDialog() {
  const open = useStore(uiStore, (s) => s.settingsOpen);
  const ref = useRef<HTMLDialogElement>(null);
  // Checked once at mount: the dialog is always mounted, so this runs at app start.
  const [storageOk] = useState(storageAvailable);
  const writeFailed = useStore(storageHealth, (h) => h.writeFailed);
  const { defaultVolume } = useSettings();
  const favs = useFavorites();
  const entries = useHistory();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.hasAttribute('open')) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    } else if (!open && d.hasAttribute('open')) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);

  // Escape and the native close path both land here. Focus return is handled by the browser.
  const onClose = () => {
    if (uiStore.get().settingsOpen) setSettingsOpen(false);
  };

  // With no padding on <dialog>, a click whose target is the dialog itself is on the backdrop.
  const onDialogClick = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) setSettingsOpen(false);
  };

  const onVolume = (e: ChangeEvent<HTMLInputElement>) => {
    settings.setDefaultVolume(Number(e.target.value));
    player.setVolume(settings.get().defaultVolume);
  };

  return (
    <dialog
      ref={ref}
      className="ss-settings"
      aria-labelledby="ss-settings-title"
      onClose={onClose}
      onClick={onDialogClick}
    >
      <div className="ss-settings__panel">
        <div className="ss-settings__head">
          <h2 id="ss-settings-title" className="ss-settings__title">
            Settings
          </h2>
          <IconButton label="Close settings" onClick={() => setSettingsOpen(false)}>
            <CloseIcon />
          </IconButton>
        </div>

        {(!storageOk || writeFailed) && (
          <p className="ss-settings__notice">
            This browser is blocking local storage, so favorites and history won't be saved after you close the tab.
          </p>
        )}

        <ul className="ss-settings__rows">
          <li className="ss-settings__row">
            <label htmlFor="ss-default-volume" className="ss-settings__label">
              Default Volume
            </label>
            <div className="ss-settings__control">
              <input
                id="ss-default-volume"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={defaultVolume}
                onChange={onVolume}
              />
              <output htmlFor="ss-default-volume" className="ss-settings__readout">
                {Math.round(defaultVolume * 100)}%
              </output>
            </div>
          </li>

          <li className="ss-settings__row">
            <div className="ss-settings__text">
              <span className="ss-settings__label">Clear Favorites</span>
              <span className="ss-settings__hint">
                {favs.length} {favs.length === 1 ? 'station' : 'stations'} saved
              </span>
            </div>
            <ConfirmClearButton
              idleLabel="Clear"
              disabled={favs.length === 0}
              onConfirm={() => favorites.clear()}
            />
          </li>

          <li className="ss-settings__row">
            <div className="ss-settings__text">
              <span className="ss-settings__label">Clear Listening History</span>
              <span className="ss-settings__hint">
                {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
              </span>
            </div>
            <ConfirmClearButton
              idleLabel="Clear"
              disabled={entries.length === 0}
              onConfirm={() => history.clear()}
            />
          </li>

          <li className="ss-settings__row ss-settings__row--stack">
            <details className="ss-about">
              <summary className="ss-about__summary">About SignalSurf</summary>
              <div className="ss-about__body">
                <p>
                  SignalSurf is a free explorer for internet radio stations around the world. Station data comes from
                  the community-run Radio Browser directory; streams are played directly from each broadcaster.
                </p>
                <p>
                  <a href="https://www.radio-browser.info/" target="_blank" rel="noopener noreferrer">
                    Radio Browser
                  </a>
                </p>
                <p>
                  Map data:{' '}
                  <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">
                    Natural Earth
                  </a>{' '}
                  (public domain)
                </p>
              </div>
            </details>
          </li>
        </ul>
      </div>
    </dialog>
  );
}
