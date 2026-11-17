import { useId, useLayoutEffect, useRef, useState } from 'react';
import { GENRE_FILTERS, GENRE_LABEL } from '@/catalog/genres';
import { catalogStore } from '@/catalog/catalog';
import { useStore } from '@/lib/createStore';
import { countLabel } from '@/lib/format';
import { exploreStore, setGenre } from '@/state/explore';
import type { GenreFilter } from '@/types';
import './CategoryFilters.css';

// Wrapped chips taking more rows than this get a More/Fewer toggle; collapsed they show this many rows.
const COLLAPSIBLE_ROWS = 3;

function label(g: GenreFilter): string {
  return g === 'all' ? 'All' : GENRE_LABEL[g];
}

/**
 * Genre chips (All plus each genre), wrapping onto rows, then the filtered station count. The count is
 * the list's polite live-region text.
 */
export function CategoryFilters() {
  const genre = useStore(exploreStore, (s) => s.genre);
  const total = useStore(exploreStore, (s) => s.results.length);
  const status = useStore(catalogStore, (s) => s.status);
  const chipsId = useId();
  const chipsRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(0);
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    const el = chipsRef.current;
    if (!el) return;
    // Clipped chips keep their layout, so the row count stays right while collapsed.
    const measure = () => setRows(new Set(Array.from(el.children, (c) => (c as HTMLElement).offsetTop)).size);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const collapsible = rows > COLLAPSIBLE_ROWS;
  const collapsed = collapsible && !expanded;
  const ready = status === 'ready';

  return (
    <div className="ss-chip-block">
      <div
        id={chipsId}
        ref={chipsRef}
        className={collapsed ? 'ss-chips ss-chips--collapsed' : 'ss-chips'}
        role="group"
        aria-label="Genre"
      >
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
      {collapsible && (
        <button
          type="button"
          className="ss-chips__more"
          aria-expanded={expanded}
          aria-controls={chipsId}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Fewer genres' : 'More genres'}
        </button>
      )}
      <p className="ss-chip-block__count" role="status" aria-live="polite">
        {ready ? countLabel(total) : ''}
      </p>
    </div>
  );
}
