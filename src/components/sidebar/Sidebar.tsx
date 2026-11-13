// STUB — replaced by slice S2
import { FavoritesView } from '@/components/views/FavoritesView';
import { HistoryView } from '@/components/views/HistoryView';
import { useStore } from '@/lib/createStore';
import { uiStore } from '@/state/ui';

export function Sidebar() {
  const view = useStore(uiStore, (s) => s.view);
  return (
    <aside className="ss-sidebar-stub" aria-label="Stations">
      {view === 'favorites' && <FavoritesView />}
      {view === 'history' && <HistoryView />}
    </aside>
  );
}
