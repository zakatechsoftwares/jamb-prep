import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { SubjectCombinationOption } from '@jamb/shared';
import { loadLocalCandidate, saveLocalSubjectCombination } from '../lib/database';
import {
  listSubjectCombinations,
  selectSubjectCombination,
} from '../lib/subject-combination-api-client';
import { colors, radii, shadows } from '../theme';

/**
 * Onboarding's course-selection step (plan 6.1) — reached right after registration.
 */
export default function ChooseCourseScreen() {
  const router = useRouter();
  const [combinations, setCombinations] = useState<SubjectCombinationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      const candidate = await loadLocalCandidate();
      if (!candidate) {
        router.replace('/register');
        return;
      }

      try {
        const { combinations: fetched } = await listSubjectCombinations(candidate.token);
        setCombinations(fetched);
      } catch {
        setError('Could not reach the server. Check your connection and try again.');
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function handleSelect(combination: SubjectCombinationOption) {
    const candidate = await loadLocalCandidate();
    if (!candidate) {
      router.replace('/register');
      return;
    }

    setError(null);
    setSelectingId(combination.id);
    try {
      await selectSubjectCombination(candidate.token, { subjectCombinationId: combination.id });
      await saveLocalSubjectCombination(combination.id, combination.courseName);
      router.replace('/');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSelectingId(null);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading course catalogue…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Choose Your Course</Text>
        <Text style={styles.subtitle}>
          Your 4 compulsory and elective UTME exam subjects will be derived automatically from your
          programme.
        </Text>
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.error}>{error}</Text>
        </View>
      )}

      <FlatList
        data={combinations}
        keyExtractor={(combination) => String(combination.id)}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const isSelected = selectingId === item.id;
          return (
            <Pressable
              onPress={() => void handleSelect(item)}
              disabled={selectingId !== null}
              style={({ pressed }) => [
                styles.courseCard,
                isSelected && styles.courseCardSelected,
                pressed && selectingId === null && styles.cardPressed,
              ]}
            >
              <View style={styles.cardTopRow}>
                <Text style={styles.courseName}>{item.courseName}</Text>
                {isSelected ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={styles.selectArrow}>→</Text>
                )}
              </View>

              <View style={styles.subjectChipsRow}>
                {item.subjects.map((subject) => (
                  <View key={subject.subjectId} style={styles.subjectChip}>
                    <Text style={styles.subjectChipText}>{subject.subjectName}</Text>
                  </View>
                ))}
              </View>
            </Pressable>
          );
        }}
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: colors.background,
  },
  loadingText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  header: {
    gap: 6,
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
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.dangerLight,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  errorIcon: {
    fontSize: 16,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  listContent: {
    gap: 12,
    paddingBottom: 24,
  },
  courseCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    gap: 12,
    ...shadows.subtle,
  },
  courseCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  courseName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
  },
  selectArrow: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.primary,
    marginLeft: 8,
  },
  subjectChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  subjectChip: {
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  subjectChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  cardPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
});
