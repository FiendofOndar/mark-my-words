import { Navigate, Route, Routes } from 'react-router-dom';
import { PullProvider } from './ui/PullProvider';
import { useShareTarget } from './capture/useShareTarget';
import { useArchiveQueue } from './capture/useArchiveQueue';
import { useScheduledNotifications } from './ui/useNotifications';
import { FeedScreen } from './ui/screens/FeedScreen';
import { DetailScreen } from './ui/screens/DetailScreen';
import { CaptureScreen } from './ui/screens/CaptureScreen';
import { ReviewScreen } from './ui/screens/ReviewScreen';
import { StandingsScreen } from './ui/screens/StandingsScreen';
import { AuthorScreen } from './ui/screens/AuthorScreen';
import { SettingsScreen } from './ui/screens/SettingsScreen';

export function App() {
  // Mounted once, above the routes, so they run whatever screen is showing.
  useShareTarget();
  useArchiveQueue();
  useScheduledNotifications();

  return (
    <PullProvider>
      <Routes>
        <Route path="/" element={<FeedScreen />} />
        <Route path="/new" element={<CaptureScreen />} />
        <Route path="/draft/:id" element={<ReviewScreen />} />
        <Route path="/p/:id" element={<DetailScreen />} />
        <Route path="/standings" element={<StandingsScreen />} />
        <Route path="/author/:id" element={<AuthorScreen />} />
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </PullProvider>
  );
}
