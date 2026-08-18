import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { downloadAvailablePacks } from '../lib/content-sync';
import { loadDownloadedSubjects, type DownloadedSubject } from '../lib/database';

/**
 * The Practice mode subject picker (plan 6.1) — lists only subjects with a
 * downloaded pack. "Check for updates" re-runs content sync on demand,
 * on top of the opportunistic sync `_layout.tsx` already triggers on
 * launch (see `content-sync.ts`'s own doc comment for why this is
 * additive to, not a replacement for, the existing Mock CBT demo).
 */
export default function PracticeSubjectsScreen() {
  const router = useRouter();
  const [subjects, setSubjects] = useState<DownloadedSubject[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    setSubjects(await loadDownloadedSubjects());
  }, []);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  async function handleCheckForUpdates() {
    setSyncing(true);
    await downloadAvailablePacks();
    await refresh();
    setSyncing(false);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Practice</Text>

      <Pressable onPress={handleCheckForUpdates} disabled={syncing} style={styles.checkButton}>
        {syncing ? <ActivityIndicator /> : <Text style={styles.checkButtonText}>Check for updates</Text>}
      </Pressable>

      {loading && <Text style={styles.empty}>Loading…</Text>}
      {!loading && subjects.length === 0 && (
        <Text style={styles.empty}>
          No downloaded subjects yet. Register (from Home) and check for updates once you have a
          connection.
        </Text>
      )}

      <FlatList
        data={subjects}
        keyExtractor={(subject) => String(subject.subjectId)}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/practice-session', params: { subjectId: item.subjectId } })}
            style={styles.row}
          >
            <Text style={styles.subjectName}>{item.subjectName}</Text>
            <Text style={styles.itemCount}>{item.itemCount} items</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: '600' },
  checkButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#1d4ed8',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  checkButtonText: { color: '#fff', fontWeight: '600' },
  empty: { fontSize: 14, color: '#555' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  subjectName: { fontSize: 16, fontWeight: '500' },
  itemCount: { fontSize: 14, color: '#555' },
});
