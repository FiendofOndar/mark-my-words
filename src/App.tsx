import { Navigate, Route, Routes } from 'react-router-dom';
import { FeedScreen } from './ui/screens/FeedScreen';
import { DetailScreen } from './ui/screens/DetailScreen';
import { CaptureScreen } from './ui/screens/CaptureScreen';
import { ReviewScreen } from './ui/screens/ReviewScreen';
import { StandingsScreen } from './ui/screens/StandingsScreen';
import { SettingsScreen } from './ui/screens/SettingsScreen';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<FeedScreen />} />
      <Route path="/new" element={<CaptureScreen />} />
      <Route path="/draft/:id" element={<ReviewScreen />} />
      <Route path="/p/:id" element={<DetailScreen />} />
      <Route path="/standings" element={<StandingsScreen />} />
      <Route path="/settings" element={<SettingsScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
