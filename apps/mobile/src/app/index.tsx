import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { APP_NAME } from '@jamb/shared';
import { loadLocalCandidate } from '../lib/database';
import { completeSignOut, trySignOut } from '../lib/sync';
import { colors, radii, shadows } from '../theme';

export default function Home() {
  const router = useRouter();
  const [status, setStatus] = useState<
    { kind: 'not_registered' } | { kind: 'no_course' } | { kind: 'ready'; courseName: string }
  >({ kind: 'not_registered' });
  const [signOut, setSignOut] = useState<
    | { kind: 'idle' }
    | { kind: 'checking' }
    | { kind: 'confirm' }
    | { kind: 'blocked'; message: string }
    | { kind: 'signing_out' }
  >({ kind: 'idle' });

  // The sign-out rule itself lives in @jamb/shared's candidate-sign-out-policy
  // (rule 7); this only turns its answer into what the candidate sees.
  async function handleSignOutPress() {
    setSignOut({ kind: 'checking' });
    const decision = await trySignOut(new Date());
    if (decision.canSignOut) {
      setSignOut({ kind: 'confirm' });
    } else if (decision.reason === 'mock_in_progress') {
      setSignOut({
        kind: 'blocked',
        message:
          'You have a mock exam in progress. Open it and finish it before signing out — if its time has run out, opening it ends it.',
      });
    } else {
      const count = decision.unsyncedCount;
      setSignOut({
        kind: 'blocked',
        message: `${count} ${count === 1 ? 'session has' : 'sessions have'} not uploaded yet. Connect to the internet and try again, so none of your answers are lost.`,
      });
    }
  }

  async function handleConfirmSignOut() {
    setSignOut({ kind: 'signing_out' });
    await completeSignOut();
    setStatus({ kind: 'not_registered' });
    setSignOut({ kind: 'idle' });
  }

  // Reloaded every time Home comes into view, not just on first mount, so
  // returning from registration (even part-way, before choosing a course)
  // shows the current identity and its Sign out button straight away.
  useFocusEffect(
    useCallback(() => {
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
    }, []),
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      {/* Hero Welcome Card */}
      <View style={styles.heroCard}>
        <View style={styles.heroBadgeRow}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>UTME 2026 EDITION</Text>
          </View>
          <View style={styles.offlineBadge}>
            <Text style={styles.offlineBadgeText}>● Offline Ready</Text>
          </View>
        </View>
        <Text style={styles.heroTitle}>{APP_NAME}</Text>
        <Text style={styles.heroSubtitle}>
          Master your 4 exam subjects with authentic CBT simulation and curriculum-aligned practice.
        </Text>
      </View>

      {/* Main Mode 1: Full Mock CBT Exam */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.modeIconCircle}>
            <Text style={styles.modeIconText}>⏱</Text>
          </View>
          <View style={styles.cardHeaderText}>
            <Text style={styles.cardTitle}>Full CBT Mock Exam</Text>
            <Text style={styles.cardTag}>180 Questions • 120 Minutes</Text>
          </View>
        </View>
        <Text style={styles.cardDescription}>
          Experience authentic JAMB examination conditions with synchronized consolidated timing and multi-subject navigation.
        </Text>
        <Pressable
          onPress={() => router.push('/mock-session')}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
        >
          <Text style={styles.primaryButtonText}>Start Mock Exam</Text>
        </Pressable>
      </View>

      {/* Main Mode 2: Targeted Practice Mode */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={[styles.modeIconCircle, styles.practiceIconCircle]}>
            <Text style={styles.modeIconText}>📚</Text>
          </View>
          <View style={styles.cardHeaderText}>
            <Text style={styles.cardTitle}>Subject Practice</Text>
            <Text style={[styles.cardTag, styles.practiceTag]}>Topic Drills • Instant Rationale</Text>
          </View>
        </View>
        <Text style={styles.cardDescription}>
          Train item by item at your own pace with immediate step-by-step solutions and distractor explanations.
        </Text>
        <Pressable
          onPress={() => router.push('/practice')}
          style={({ pressed }) => [styles.secondaryActionButton, pressed && styles.buttonPressed]}
        >
          <Text style={styles.secondaryActionText}>Practice Questions</Text>
        </Pressable>
      </View>

      {/* Candidate Status & Onboarding Card */}
      <View style={styles.statusCard}>
        <Text style={styles.statusCardTitle}>Candidate Profile</Text>
        {status.kind === 'not_registered' && (
          <View style={styles.statusActionBox}>
            <Text style={styles.statusDescription}>
              Register your profile to back up your attempt history and sync progress across devices.
            </Text>
            <Pressable
              onPress={() => router.push('/register')}
              style={({ pressed }) => [styles.linkButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.linkButtonText}>Register to Sync Progress →</Text>
            </Pressable>
          </View>
        )}
        {status.kind === 'no_course' && (
          <View style={styles.statusActionBox}>
            <Text style={styles.statusDescription}>
              Pick your intended tertiary course to automatically derive your 4 required UTME subjects.
            </Text>
            <Pressable
              onPress={() => router.push('/choose-course')}
              style={({ pressed }) => [styles.linkButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.linkButtonText}>Select Intended Course →</Text>
            </Pressable>
          </View>
        )}
        {status.kind === 'ready' && (
          <View style={styles.readyRow}>
            <View style={styles.readyIndicator} />
            <View style={styles.readyTextBox}>
              <Text style={styles.readyCourseName}>{status.courseName}</Text>
              <Text style={styles.readySubtext}>Combination derived & ready for full mock</Text>
            </View>
          </View>
        )}

        {status.kind !== 'not_registered' && signOut.kind === 'confirm' && (
          <View style={styles.signOutPanel}>
            <Text style={styles.signOutPanelText}>
              Sign out? You can sign back in any time by registering with the same phone number.
            </Text>
            <View style={styles.signOutPanelButtons}>
              <Pressable
                onPress={() => setSignOut({ kind: 'idle' })}
                style={({ pressed }) => [styles.signOutCancelButton, pressed && styles.buttonPressed]}
              >
                <Text style={styles.signOutCancelText}>Stay signed in</Text>
              </Pressable>
              <Pressable
                onPress={() => void handleConfirmSignOut()}
                style={({ pressed }) => [styles.signOutConfirmButton, pressed && styles.buttonPressed]}
              >
                <Text style={styles.signOutConfirmText}>Sign out</Text>
              </Pressable>
            </View>
          </View>
        )}

        {status.kind !== 'not_registered' && signOut.kind === 'blocked' && (
          <View style={[styles.signOutPanel, styles.signOutPanelBlocked]}>
            <Text style={styles.signOutPanelText}>{signOut.message}</Text>
            <Pressable
              onPress={() => setSignOut({ kind: 'idle' })}
              style={({ pressed }) => [styles.signOutCancelButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.signOutCancelText}>OK</Text>
            </Pressable>
          </View>
        )}

        {status.kind !== 'not_registered' &&
          (signOut.kind === 'idle' || signOut.kind === 'checking' || signOut.kind === 'signing_out') && (
            <Pressable
              disabled={signOut.kind !== 'idle'}
              onPress={() => void handleSignOutPress()}
              style={({ pressed }) => [styles.signOutButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.signOutButtonText}>
                {signOut.kind === 'idle' ? 'Sign out' : 'Checking your answers are uploaded…'}
              </Text>
            </Pressable>
          )}
      </View>

      {/* Footer Assurance */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Offline-first architecture • All attempts stored securely locally
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  signOutButton: {
    marginTop: 12,
    minHeight: 48,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.borderDark,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  signOutButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  signOutPanel: {
    marginTop: 12,
    gap: 12,
    padding: 14,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.primaryBorder,
    backgroundColor: colors.primaryLight,
  },
  signOutPanelBlocked: {
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningLight,
  },
  signOutPanelText: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  signOutPanelButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  signOutCancelButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.borderDark,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutCancelText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  signOutConfirmButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: radii.md,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutConfirmText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textInverted,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    padding: 16,
    gap: 16,
    paddingBottom: 32,
  },
  heroCard: {
    backgroundColor: colors.brandNavy,
    borderRadius: radii.lg,
    padding: 20,
    gap: 8,
    ...shadows.card,
  },
  heroBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  badge: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.full,
  },
  badgeText: {
    color: '#93c5fd',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  offlineBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.full,
  },
  offlineBadgeText: {
    color: '#6ee7b7',
    fontSize: 11,
    fontWeight: '600',
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.textInverted,
    letterSpacing: -0.5,
  },
  heroSubtitle: {
    fontSize: 14,
    color: '#cbd5e1',
    lineHeight: 20,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.subtle,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  modeIconCircle: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  practiceIconCircle: {
    backgroundColor: colors.brandEmeraldLight,
  },
  modeIconText: {
    fontSize: 22,
  },
  cardHeaderText: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  cardTag: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
  practiceTag: {
    color: colors.brandEmerald,
  },
  cardDescription: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    paddingVertical: 13,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.subtle,
  },
  primaryButtonText: {
    color: colors.textInverted,
    fontWeight: '700',
    fontSize: 15,
  },
  secondaryActionButton: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderDark,
    paddingVertical: 13,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: {
    color: colors.textPrimary,
    fontWeight: '600',
    fontSize: 15,
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  statusCardTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statusActionBox: {
    gap: 8,
  },
  statusDescription: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  linkButton: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  linkButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  readyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.brandEmeraldLight,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.brandEmeraldBorder,
  },
  readyIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.brandEmerald,
  },
  readyTextBox: {
    flex: 1,
  },
  readyCourseName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#065f46',
  },
  readySubtext: {
    fontSize: 12,
    color: '#047857',
  },
  footer: {
    alignItems: 'center',
    paddingTop: 8,
  },
  footerText: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
