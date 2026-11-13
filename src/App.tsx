import { PlayerBar } from '@/components/player/PlayerBar';
import { Header } from '@/components/layout/Header';
import { SettingsDialog } from '@/components/settings/SettingsDialog';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { WorldMap } from '@/map/WorldMap';
import './App.css';

export function App() {
  return (
    <>
      <a className="ss-skip-link" href="#stations">
        Skip to stations
      </a>
      <div className="ss-app">
        <div className="ss-app__header">
          <Header />
        </div>
        <div className="ss-app__sidebar">
          <Sidebar />
        </div>
        <main className="ss-app__map ss-panel">
          <WorldMap />
        </main>
        <div className="ss-app__player ss-panel">
          <PlayerBar />
        </div>
      </div>
      <SettingsDialog />
    </>
  );
}
