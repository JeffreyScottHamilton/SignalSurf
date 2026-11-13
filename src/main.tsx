import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import { App } from './App';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { player } from './audio/player';
import { history } from './storage/history';

// Every station that actually starts playing is recorded in history.
player.onStarted((s) => history.add(s));

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root element');

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
