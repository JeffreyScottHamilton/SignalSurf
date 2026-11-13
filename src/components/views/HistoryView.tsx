import { useMemo } from 'react';
import { StationRow } from '@/components/common/StationRow';
import { dayLabel, formatPlayedAt } from '@/lib/format';
import { history, useHistory } from '@/storage/history';
import type { HistoryEntry } from '@/types';
import { ConfirmClearButton } from './ConfirmClearButton';
import { playStation, usePlayingId, useSelectedId } from './viewState';
import './views.css';

interface DayGroup {
  label: string;
  entries: HistoryEntry[];
}

/** Groups by day label, keeping the newest-first order of the entries. */
function groupByDay(entries: HistoryEntry[]): DayGroup[] {
  const groups = new Map<string, HistoryEntry[]>();
  for (const e of entries) {
    const label = dayLabel(e.playedAt);
    const bucket = groups.get(label);
    if (bucket) bucket.push(e);
    else groups.set(label, [e]);
  }
  return [...groups].map(([label, list]) => ({ label, entries: list }));
}

export function HistoryView() {
  const entries = useHistory();
  const selectedId = useSelectedId();
  const playingId = usePlayingId();
  const groups = useMemo(() => groupByDay(entries), [entries]);

  return (
    <section className="ss-view" aria-labelledby="ss-history-title">
      <div className="ss-view__head">
        <h2 id="ss-history-title" className="ss-view__title">
          Listening History
        </h2>
        <ConfirmClearButton
          idleLabel="Clear History"
          disabled={entries.length === 0}
          onConfirm={() => history.clear()}
        />
      </div>

      {entries.length === 0 ? (
        <div className="ss-empty">
          <p className="ss-empty__title">Nothing played yet</p>
          <p>Stations you listen to will show up here.</p>
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.label} className="ss-history-group">
            <h3 className="ss-view__group">{group.label}</h3>
            <ul className="ss-list">
              {group.entries.map((e) => (
                <li key={e.station.id} className="ss-view-row">
                  <StationRow
                    station={e.station}
                    selected={selectedId === e.station.id}
                    playing={playingId === e.station.id}
                    meta={formatPlayedAt(e.playedAt)}
                    onActivate={() => playStation(e.station, entries.map((x) => x.station))}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
