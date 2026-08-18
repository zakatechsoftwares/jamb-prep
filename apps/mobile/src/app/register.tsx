import { useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ensureRegistered } from '../lib/sync';

/**
 * The one-time registration step for progress sync (plan 8.3) — optional,
 * never required to practise or sit a mock (rule 1). Lightweight phone-based
 * identity: no password, matching the proportionate-for-now auth decision
 * documented in this session's build-log entry.
 */
export default function RegisterScreen() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [examYear, setExamYear] = useState(String(new Date().getFullYear()));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    if (fullName.trim() === '') {
      setError('Full name is required.');
      return;
    }
    if (phone.trim() === '') {
      setError('Phone number is required.');
      return;
    }
    const examYearNum = Number(examYear);
    if (!Number.isInteger(examYearNum) || examYearNum <= 0) {
      setError('Exam year must be a positive number.');
      return;
    }

    setSubmitting(true);
    try {
      await ensureRegistered(fullName, phone, examYearNum);
      router.replace('/choose-course');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Register to sync progress</Text>
      <Text style={styles.subtitle}>Optional — you can practise and sit mocks fully offline without this.</Text>

      <TextInput
        style={styles.input}
        placeholder="Full name"
        value={fullName}
        onChangeText={setFullName}
        accessibilityLabel="Full name"
      />
      <TextInput
        style={styles.input}
        placeholder="Phone number"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        accessibilityLabel="Phone number"
      />
      <TextInput
        style={styles.input}
        placeholder="Exam year"
        value={examYear}
        onChangeText={setExamYear}
        keyboardType="number-pad"
        accessibilityLabel="Exam year"
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable onPress={handleSubmit} disabled={submitting} style={styles.button}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Register</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '600' },
  subtitle: { fontSize: 13, color: '#555' },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  error: { color: '#dc2626', fontSize: 13 },
  button: {
    backgroundColor: '#1d4ed8',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
