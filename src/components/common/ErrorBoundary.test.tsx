import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Boom(): never {
  throw new Error('render failed');
}

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  // React logs caught render errors; keep the test output quiet.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  host.remove();
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', async () => {
    await act(async () => {
      createRoot(host).render(
        <ErrorBoundary>
          <p>All good</p>
        </ErrorBoundary>,
      );
    });
    expect(host.textContent).toContain('All good');
  });

  it('shows a reload message and button instead of a blank page when a child throws', async () => {
    await act(async () => {
      createRoot(host).render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );
    });
    expect(host.textContent).toContain('Something went wrong. Reload the page.');
    const button = host.querySelector('button');
    expect(button?.textContent).toBe('Reload');
  });
});
