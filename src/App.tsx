import { PlayerBar } from '@/components/player/PlayerBar';
import { Header } from '@/components/layout/Header';
import { SettingsDialog } from '@/components/settings/SettingsDialog';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { WorldMap } from '@/map/WorldMap';
import './App.css';

export function App() {
  return (
    <>
      <div className="ss-app">
        <div className="ss-app__header">
          <Header />
        </div>
        <div className="ss-app__sidebar ss-panel">
          <Sidebar />
        </div>
        <div className="ss-app__map ss-panel">
          <WorldMap />
        </div>
        <div className="ss-app__player ss-panel">
          <PlayerBar />
        </div>
      </div>
      <SettingsDialog />
    </>
  );
}
