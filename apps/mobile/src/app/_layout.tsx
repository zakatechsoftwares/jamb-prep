import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { downloadAvailablePacks } from '../lib/content-sync';
import { syncPendingSessions } from '../lib/sync';

export default function RootLayout() {
  // Best-effort retry of any session that failed to sync last time, and an
  // opportunistic content-pack check (rule 1 means neither can ever block
  // rendering) — see sync.ts / content-sync.ts.
  useEffect(() => {
    void syncPendingSessions();
    void downloadAvailablePacks();
  }, []);

  return <Stack screenOptions={{ headerTitle: 'JAMB UTME Prep' }} />;
}
