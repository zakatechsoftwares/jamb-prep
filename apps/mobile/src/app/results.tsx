import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { scoreExam, type ScoreResult } from '@jamb/shared';
import { loadScoringAttempts } from '../lib/database';
import { DEMO_EXAM_CONFIG, DEMO_SUBJECTS } from '../lib/demo-fixture';

function subjectName(subjectId: number): string {
  return DEMO_SUBJECTS.find((subject) => subject.subjectId === subjectId)?.name ?? `Subject ${subjectId}`;
}

export default function ResultsScreen() {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  const [score, setScore] = useState<ScoreResult | null>(null);

  // The score is derived here, from the database, rather than passed as
  // in-memory state from the mock-session screen -- each screen that calls
  // a hook gets its own independent instance, so the database (via
  // sessionId, the one thing carried across navigation) is the only shared
  // source of truth between them.
  useEffect(() => {
    const parsedId = sessionId ? Number(sessionId) : NaN;
    if (!Number.isInteger(parsedId)) {
      return;
    }
    void loadScoringAttempts(parsedId).then((attempts) => {
      setScore(scoreExam(DEMO_EXAM_CONFIG, attempts));
    });
  }, [sessionId]);

  if (!score) {
    return (
      <View style={styles.center}>
        <Text>Loading…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.aggregate}>
        {score.aggregateScore} / {score.aggregateMaxMarks}
      </Text>
      {score.subjectScores.map((subjectScore) => (
        <View key={subjectScore.subjectId} style={styles.row}>
          <Text style={styles.subject}>{subjectName(subjectScore.subjectId)}</Text>
          <Text style={styles.subjectScore}>
            {subjectScore.score} / {subjectScore.maxMarks}
          </Text>
        </View>
      ))}
      <Pressable onPress={() => router.replace('/')} style={styles.button}>
        <Text style={styles.buttonText}>Back to home</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  aggregate: { fontSize: 32, fontWeight: '700', textAlign: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  subject: { fontSize: 16 },
  subjectScore: { fontSize: 16, fontWeight: '600' },
  button: {
    marginTop: 16,
    backgroundColor: '#1d4ed8',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
