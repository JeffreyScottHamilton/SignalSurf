import { GENRE_FILTERS, GENRE_LABEL } from '@/catalog/genres';
import { useStore } from '@/lib/createStore';
import { exploreStore, setGenre } from '@/state/explore';
import type { GenreFilter } from '@/types';
import './CategoryFilters.css';

function label(g: GenreFilter): string {
  return g === 'all' ? 'All' : GENRE_LABEL[g];
}

/** Genre chips: All plus one per genre. Pressed chip is the active filter. */
export function CategoryFilters() {
  const genre = useStore(exploreStore, (s) => s.genre);
  return (
    <div className="ss-chips" role="group" aria-label="Genre">
      {GENRE_FILTERS.map((g) => (
        <button
          key={g}
          type="button"
          className="ss-chip"
          aria-pressed={genre === g}
          onClick={() => setGenre(g)}
        >
          {label(g)}
        </button>
      ))}
    </div>
  );
}
