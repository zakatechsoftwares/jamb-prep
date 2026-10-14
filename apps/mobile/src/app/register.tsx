import { useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ensureRegistered } from '../lib/sync';
import { colors, radii, shadows } from '../theme';

/**
 * The one-time registration step for progress sync (plan 8.3) — optional,
 * never required to practise or sit a mock (rule 1). Lightweight phone-based
 * identity: no password.
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
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <View style={styles.headerBox}>
            <View style={styles.iconCircle}>
              <Text style={styles.iconText}>👤</Text>
            </View>
            <Text style={styles.title}>Candidate Registration</Text>
            <Text style={styles.subtitle}>
              Register once to back up test history and synchronize question packs across devices.
            </Text>
          </View>

          <View style={styles.form}>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Full Name</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Amina Bello"
                placeholderTextColor={colors.textMuted}
                value={fullName}
                onChangeText={setFullName}
                accessibilityLabel="Full name"
                autoCapitalize="words"
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Phone Number</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 08012345678"
                placeholderTextColor={colors.textMuted}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                accessibilityLabel="Phone number"
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>UTME Exam Year</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 2026"
                placeholderTextColor={colors.textMuted}
                value={examYear}
                onChangeText={setExamYear}
                keyboardType="number-pad"
                accessibilityLabel="Exam year"
              />
            </View>

            {error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorIcon}>⚠️</Text>
                <Text style={styles.error}>{error}</Text>
              </View>
            )}

            <Pressable
              onPress={handleSubmit}
              disabled={submitting}
              style={({ pressed }) => [
                styles.button,
                submitting && styles.buttonDisabled,
                pressed && !submitting && styles.buttonPressed,
              ]}
            >
              {submitting ? (
                <ActivityIndicator color={colors.textInverted} />
              ) : (
                <Text style={styles.buttonText}>Register & Select Course</Text>
              )}
            </Pressable>
          </View>

          <View style={styles.noticeBox}>
            <Text style={styles.noticeText}>
              🔒 Offline First: You can practise and sit full mocks without registering.
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    padding: 16,
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 20,
    ...shadows.card,
  },
  headerBox: {
    alignItems: 'center',
    gap: 8,
    textAlign: 'center',
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  iconText: {
    fontSize: 26,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 8,
  },
  form: {
    gap: 14,
  },
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.textPrimary,
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
  button: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: radii.md,
    alignItems: 'center',
    marginTop: 6,
    ...shadows.subtle,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: colors.textInverted,
    fontWeight: '700',
    fontSize: 16,
  },
  noticeBox: {
    backgroundColor: colors.surfaceAlt,
    padding: 12,
    borderRadius: radii.md,
  },
  noticeText: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 17,
  },
  buttonPressed: {
    opacity: 0.85,
  },
});
