import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { syncPendingSessions } from '../lib/sync';

export default function RootLayout() {
  // Best-effort retry of any session that failed to sync last time (rule 1
  // means this can never block rendering) — see sync.ts.
  useEffect(() => {
    void syncPendingSessions();
  }, []);

  return <Stack screenOptions={{ headerTitle: 'JAMB UTME Prep' }} />;
}
