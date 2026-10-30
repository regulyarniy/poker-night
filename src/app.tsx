/**
 * Приложение: загрузка данных и выбор экрана по маршруту (docs/SPEC.md §5.1).
 */

import { useEffect } from 'preact/hooks';
import { route, startRouter } from './router';
import { GameScreen } from './screens/game';
import { HistoryScreen } from './screens/history';
import { HomeScreen, NotFoundScreen } from './screens/home';
import { NewGameScreen } from './screens/new-game';
import { ResultsScreen } from './screens/results';
import { SettingsScreen } from './screens/settings';
import { ShareScreen } from './screens/share';
import { boot, ready } from './state/store';
import { ToastView } from './ui/kit';

export function App() {
  useEffect(() => {
    const stop = startRouter();
    void boot();
    return stop;
  }, []);

  if (!ready.value) {
    return (
      <div class="shell">
        <div class="screen">
          <div class="empty">Загрузка…</div>
        </div>
      </div>
    );
  }

  return (
    <div class="shell">
      {renderRoute()}
      <ToastView />
    </div>
  );
}

function renderRoute() {
  const current = route.value;
  switch (current.name) {
    case 'home':
      return <HomeScreen />;
    case 'new':
      return <NewGameScreen cloneId={current.cloneId} />;
    case 'game':
      return <GameScreen id={current.id} />;
    case 'results':
      return <ResultsScreen id={current.id} />;
    case 'history':
      return <HistoryScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'share':
      return <ShareScreen payload={current.payload} />;
    case 'notFound':
      return <NotFoundScreen />;
  }
}
