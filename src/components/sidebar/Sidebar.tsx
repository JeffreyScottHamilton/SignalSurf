import { FavoritesView } from '@/components/views/FavoritesView';
import { HistoryView } from '@/components/views/HistoryView';
import { useStore } from '@/lib/createStore';
import { setSheetOpen, uiStore } from '@/state/ui';
import { CategoryFilters } from './CategoryFilters';
import { StationList } from './StationList';
import { StationSearch } from './StationSearch';
import './Sidebar.css';

/**
 * Desktop: a bordered side panel. Mobile (<768px): a bottom sheet above the player,
 * collapsed to a bar (handle + search) or expanded to 55dvh.
 */
export function Sidebar() {
  const view = useStore(uiStore, (s) => s.view);
  const sheetOpen = useStore(uiStore, (s) => s.sheetOpen);
  // Favorites and History always show expanded on mobile.
  const expanded = view !== 'explore' || sheetOpen;
  const className = expanded ? 'ss-sidebar ss-sidebar--expanded' : 'ss-sidebar';

  return (
    <aside id="stations" tabIndex={-1} className={className} aria-label="Stations">
      {view === 'explore' && (
        <>
          <button
            type="button"
            className="ss-sheet-handle"
            aria-expanded={expanded}
            aria-controls="ss-sheet-body"
            onClick={() => setSheetOpen(!sheetOpen)}
          >
            <span className="ss-sheet-handle__bar" aria-hidden="true" />
            <span className="ss-sr-only">{expanded ? 'Collapse station list' : 'Expand station list'}</span>
          </button>
          <StationSearch />
          <div id="ss-sheet-body" className="ss-sidebar__body">
            <CategoryFilters />
            <StationList />
          </div>
        </>
      )}
      {view === 'favorites' && (
        <div className="ss-sidebar__view">
          <FavoritesView />
        </div>
      )}
      {view === 'history' && (
        <div className="ss-sidebar__view">
          <HistoryView />
        </div>
      )}
    </aside>
  );
}
