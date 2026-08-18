import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { SubjectCombinationOption } from '@jamb/shared';
import { loadLocalCandidate, saveLocalSubjectCombination } from '../lib/database';
import { listSubjectCombinations, selectSubjectCombination } from '../lib/subject-combination-api-client';

/**
 * Onboarding's course-selection step (plan 6.1: "intended course
 * selection, automatic derivation of the correct four-subject
 * combination") — reached right after registration. Requires a
 * registered candidate (a token to call the server with); if none exists
 * yet, sends the candidate back to register first rather than failing
 * silently.
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
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Choose your course</Text>
      <Text style={styles.subtitle}>
        We'll derive your four exam subjects automatically from your course.
      </Text>

      {error && <Text style={styles.error}>{error}</Text>}

      <FlatList
        data={combinations}
        keyExtractor={(combination) => String(combination.id)}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => void handleSelect(item)}
            disabled={selectingId !== null}
            style={styles.row}
          >
            <Text style={styles.courseName}>{item.courseName}</Text>
            {selectingId === item.id ? (
              <ActivityIndicator />
            ) : (
              <Text style={styles.subjects}>
                {item.subjects.map((subject) => subject.subjectName).join(', ')}
              </Text>
            )}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '600' },
  subtitle: { fontSize: 13, color: '#555' },
  error: { color: '#dc2626', fontSize: 13 },
  row: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    gap: 4,
  },
  courseName: { fontSize: 16, fontWeight: '500' },
  subjects: { fontSize: 13, color: '#555' },
});
