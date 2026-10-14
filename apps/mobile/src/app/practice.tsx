import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { downloadAvailablePacks } from '../lib/content-sync';
import { loadDownloadedSubjects, type DownloadedSubject } from '../lib/database';
import { colors, radii, shadows } from '../theme';

/**
 * The Practice mode subject picker (plan 6.1) — lists only subjects with a
 * downloaded pack. "Check for updates" re-runs content sync on demand,
 * on top of the opportunistic sync `_layout.tsx` already triggers on launch.
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
      <View style={styles.header}>
        <View style={styles.headerTextCol}>
          <Text style={styles.title}>Subject Practice</Text>
          <Text style={styles.subtitle}>
            Select a subject to drill syllabus objectives with step-by-step solutions.
          </Text>
        </View>
        <Pressable
          onPress={handleCheckForUpdates}
          disabled={syncing}
          style={({ pressed }) => [
            styles.checkButton,
            syncing && styles.checkButtonDisabled,
            pressed && styles.buttonPressed,
          ]}
        >
          {syncing ? (
            <ActivityIndicator size="small" color={colors.textInverted} />
          ) : (
            <Text style={styles.checkButtonText}>↻ Check for updates</Text>
          )}
        </Pressable>
      </View>

      {loading && (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.empty}>Loading downloaded subjects…</Text>
        </View>
      )}

      {!loading && subjects.length === 0 && (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyIcon}>📦</Text>
          <Text style={styles.emptyTitle}>No Downloaded Subjects Yet</Text>
          <Text style={styles.emptyText}>
            Ensure your course combination is registered and tap &ldquo;Check for updates&rdquo; when
            connected to download the offline question packs.
          </Text>
          <Pressable
            onPress={() => router.push('/register')}
            style={({ pressed }) => [styles.emptyActionButton, pressed && styles.buttonPressed]}
          >
            <Text style={styles.emptyActionText}>Complete Registration</Text>
          </Pressable>
        </View>
      )}

      <FlatList
        data={subjects}
        keyExtractor={(subject) => String(subject.subjectId)}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/practice-session',
                params: { subjectId: item.subjectId },
              })
            }
            style={({ pressed }) => [styles.subjectCard, pressed && styles.cardPressed]}
          >
            <View style={styles.subjectIconBox}>
              <Text style={styles.subjectInitial}>
                {item.subjectName.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.subjectInfo}>
              <Text style={styles.subjectName}>{item.subjectName}</Text>
              <View style={styles.tagRow}>
                <View style={styles.itemCountBadge}>
                  <Text style={styles.itemCountText}>{item.itemCount} items</Text>
                </View>
                <Text style={styles.offlineTag}>● Ready offline</Text>
              </View>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: colors.background,
    gap: 16,
  },
  header: {
    gap: 12,
  },
  headerTextCol: {
    gap: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  checkButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.brandNavy,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: radii.md,
    ...shadows.subtle,
  },
  checkButtonDisabled: {
    opacity: 0.7,
  },
  checkButtonText: {
    color: colors.textInverted,
    fontWeight: '600',
    fontSize: 13,
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 24,
    alignItems: 'center',
    textAlign: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.subtle,
  },
  emptyIcon: {
    fontSize: 36,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  emptyText: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
  },
  emptyActionButton: {
    marginTop: 6,
    backgroundColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: radii.md,
  },
  emptyActionText: {
    color: colors.textInverted,
    fontWeight: '600',
    fontSize: 14,
  },
  empty: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  listContent: {
    gap: 12,
    paddingBottom: 24,
  },
  subjectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 14,
    ...shadows.subtle,
  },
  subjectIconBox: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subjectInitial: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.primary,
  },
  subjectInfo: {
    flex: 1,
    gap: 4,
  },
  subjectName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  itemCountBadge: {
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radii.xs,
  },
  itemCountText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  offlineTag: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.brandEmerald,
  },
  chevron: {
    fontSize: 22,
    color: colors.textMuted,
    fontWeight: '300',
  },
  cardPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  buttonPressed: {
    opacity: 0.85,
  },
});
