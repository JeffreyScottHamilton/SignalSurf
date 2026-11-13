import { useState } from 'react';
import { SearchIcon } from '@/components/common/icons';
import { useStore } from '@/lib/createStore';
import { exploreStore, setQuery } from '@/state/explore';
import { setSheetOpen } from '@/state/ui';
import './StationSearch.css';

/**
 * Search field for the station list. Keeps a local draft so spaces typed mid-word
 * survive (the store trims the query); resyncs when the store is reset from outside.
 */
export function StationSearch() {
  const storeQuery = useStore(exploreStore, (s) => s.query);
  const [draft, setDraft] = useState(storeQuery);
  const [syncedQuery, setSyncedQuery] = useState(storeQuery);

  // Adjust state during render when the store changed from outside (e.g. resetExplore).
  if (storeQuery !== syncedQuery) {
    setSyncedQuery(storeQuery);
    if (storeQuery !== draft.trim()) setDraft(storeQuery);
  }

  return (
    <div className="ss-search">
      <label className="ss-sr-only" htmlFor="ss-station-search">
        Search stations
      </label>
      <SearchIcon className="ss-search__icon" size={18} />
      <input
        id="ss-station-search"
        className="ss-search__input"
        type="search"
        autoComplete="off"
        spellCheck={false}
        placeholder="Search stations, cities, or countries…"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setQuery(e.target.value);
        }}
        onFocus={() => setSheetOpen(true)}
      />
    </div>
  );
}
