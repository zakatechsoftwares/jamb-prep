import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { APP_NAME } from '@jamb/shared';
import { loadLocalCandidate } from '../lib/database';

export default function Home() {
  const router = useRouter();
  const [status, setStatus] = useState<
    { kind: 'not_registered' } | { kind: 'no_course' } | { kind: 'ready'; courseName: string }
  >({ kind: 'not_registered' });

  useEffect(() => {
    void (async () => {
      const candidate = await loadLocalCandidate();
      if (!candidate) {
        setStatus({ kind: 'not_registered' });
      } else if (!candidate.courseName) {
        setStatus({ kind: 'no_course' });
      } else {
        setStatus({ kind: 'ready', courseName: candidate.courseName });
      }
    })();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{APP_NAME}</Text>
      <Text style={styles.subtitle}>Mock CBT demo — offline, fixture content</Text>
      <Pressable onPress={() => router.push('/mock-session')} style={styles.button}>
        <Text style={styles.buttonText}>Go to mock session</Text>
      </Pressable>
      <Pressable onPress={() => router.push('/practice')} style={styles.button}>
        <Text style={styles.buttonText}>Practice with real questions</Text>
      </Pressable>

      {status.kind === 'not_registered' && (
        <Pressable onPress={() => router.push('/register')} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Register to sync progress</Text>
        </Pressable>
      )}
      {status.kind === 'no_course' && (
        <Pressable onPress={() => router.push('/choose-course')} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Choose your course</Text>
        </Pressable>
      )}
      {status.kind === 'ready' && <Text style={styles.courseStatus}>Your course: {status.courseName}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  title: { fontSize: 22, fontWeight: '600' },
  subtitle: { fontSize: 14, color: '#555', textAlign: 'center' },
  button: { backgroundColor: '#1d4ed8', paddingVertical: 14, paddingHorizontal: 28, borderRadius: 8 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  secondaryButton: { paddingVertical: 8, paddingHorizontal: 12 },
  secondaryButtonText: { color: '#1d4ed8', fontSize: 14, fontWeight: '500' },
  courseStatus: { fontSize: 13, color: '#555' },
});
