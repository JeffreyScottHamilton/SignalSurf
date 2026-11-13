import { CATEGORY_LABELS, CATEGORY_ORDER } from '@/api/categories';
import { useStore } from '@/lib/createStore';
import { exploreStore, setCategory } from '@/state/explore';
import './CategoryFilters.css';

/** One horizontal row of category chips; scrolls sideways instead of wrapping. */
export function CategoryFilters() {
  const category = useStore(exploreStore, (s) => s.category);
  return (
    <div className="ss-chips" role="group" aria-label="Category">
      {CATEGORY_ORDER.map((c) => (
        <button
          key={c}
          type="button"
          className="ss-chip"
          aria-pressed={category === c}
          onClick={() => setCategory(c)}
        >
          {CATEGORY_LABELS[c]}
        </button>
      ))}
    </div>
  );
}
