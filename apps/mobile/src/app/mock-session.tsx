import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { OptionLabel } from '@jamb/shared';
import { useMockSession } from '../hooks/useMockSession';
import { DEMO_ITEMS, findDemoItem } from '../lib/demo-fixture';
import { colors, radii, shadows } from '../theme';

function formatRemaining(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export default function MockSessionScreen() {
  const router = useRouter();
  const {
    phase,
    session,
    remainingSeconds,
    sessionId,
    startSession,
    selectOption,
    toggleFlag,
    navigate,
  } = useMockSession();

  // Auto-submit on expiry (or a manual submit reaching the same phase)
  // navigates to results, carrying only the session id -- the score itself
  // is derived there from the database, not passed as in-memory state.
  useEffect(() => {
    if (phase === 'finished' && sessionId !== null) {
      router.replace({ pathname: '/results', params: { sessionId: String(sessionId) } });
    }
  }, [phase, sessionId, router]);

  if (phase === 'loading' || phase === 'finished') {
    return (
      <View style={styles.center}>
        <Text style={styles.loadingText}>Loading exam environment…</Text>
      </View>
    );
  }

  if (phase === 'not_started') {
    return (
      <View style={styles.briefingContainer}>
        <View style={styles.briefingCard}>
          <View style={styles.briefingBadge}>
            <Text style={styles.briefingBadgeText}>CBT MOCK SIMULATION</Text>
          </View>
          <Text style={styles.briefingTitle}>JAMB UTME Mock Exam</Text>
          <Text style={styles.briefingSubtitle}>
            Full simulation adhering to official Computer-Based Test specifications.
          </Text>

          <View style={styles.ruleList}>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleBullet}>⏱</Text>
              <Text style={styles.ruleText}>120 Minutes consolidated across all subjects</Text>
            </View>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleBullet}>📝</Text>
              <Text style={styles.ruleText}>Navigate freely between any question or subject</Text>
            </View>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleBullet}>🎯</Text>
              <Text style={styles.ruleText}>No negative marking — attempt all questions</Text>
            </View>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleBullet}>🚩</Text>
              <Text style={styles.ruleText}>Flag uncertain questions for easy review before submission</Text>
            </View>
          </View>

          <Pressable
            onPress={() => void startSession()}
            style={({ pressed }) => [styles.startExamButton, pressed && styles.buttonPressed]}
          >
            <Text style={styles.startExamButtonText}>Start Examination</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!session) {
    return null;
  }

  const currentItem = findDemoItem(session.currentItemId);
  const currentProgress = session.progress[session.currentItemId];
  const isTimeCritical = remainingSeconds <= 300; // < 5 mins
  const isTimeWarning = remainingSeconds <= 900 && !isTimeCritical; // < 15 mins

  return (
    <View style={styles.container}>
      {/* Top Bar: Subject Pill & Digital Countdown Timer */}
      <View style={styles.examHeader}>
        <View style={styles.subjectChip}>
          <Text style={styles.subjectChipText}>{currentItem.subjectName}</Text>
        </View>
        <View
          style={[
            styles.timerBox,
            isTimeWarning && styles.timerBoxWarning,
            isTimeCritical && styles.timerBoxCritical,
          ]}
        >
          <Text style={styles.timerIcon}>⏰</Text>
          <Text
            style={[
              styles.timerText,
              isTimeWarning && styles.timerTextWarning,
              isTimeCritical && styles.timerTextCritical,
            ]}
          >
            {formatRemaining(remainingSeconds)}
          </Text>
        </View>
      </View>

      {/* Question Palette Scroll Row */}
      <View style={styles.paletteWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.palette}
          contentContainerStyle={styles.paletteContent}
        >
          {DEMO_ITEMS.map((item) => {
            const progress = session.progress[item.itemId];
            const isCurrent = item.itemId === session.currentItemId;
            return (
              <Pressable
                key={item.itemId}
                onPress={() => navigate(item.itemId)}
                style={[
                  styles.paletteCell,
                  progress?.answered && styles.paletteCellAnswered,
                  progress?.flagged && styles.paletteCellFlagged,
                  isCurrent && styles.paletteCellCurrent,
                ]}
              >
                <Text
                  style={[
                    styles.paletteCellText,
                    progress?.answered && styles.paletteCellTextAnswered,
                    isCurrent && styles.paletteCellTextCurrent,
                  ]}
                >
                  {item.itemId}
                </Text>
                {progress?.flagged && <View style={styles.flagDot} />}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Main Question Stem & Options */}
      <ScrollView style={styles.questionScroll} contentContainerStyle={styles.questionContent}>
        <View style={styles.stemCard}>
          <View style={styles.stemHeaderRow}>
            <Text style={styles.questionNumberLabel}>Item #{currentItem.itemId}</Text>
            {currentProgress?.flagged && (
              <View style={styles.flaggedChip}>
                <Text style={styles.flaggedChipText}>⚑ Flagged</Text>
              </View>
            )}
          </View>
          <Text style={styles.stem}>{currentItem.stem}</Text>
        </View>

        <View style={styles.optionsList}>
          {currentItem.options.map((option) => {
            const isSelected = currentProgress?.selectedOption === option.label;
            return (
              <Pressable
                key={option.label}
                onPress={() => void selectOption(currentItem.itemId, option.label as OptionLabel)}
                style={({ pressed }) => [
                  styles.option,
                  isSelected && styles.optionSelected,
                  pressed && styles.buttonPressed,
                ]}
              >
                <View style={[styles.optionCircle, isSelected && styles.optionCircleSelected]}>
                  <Text style={[styles.optionCircleText, isSelected && styles.optionCircleTextSelected]}>
                    {option.label}
                  </Text>
                </View>
                <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                  {option.text}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Action Controls */}
        <View style={styles.actionRow}>
          <Pressable
            onPress={() => void toggleFlag(currentItem.itemId)}
            style={({ pressed }) => [
              styles.flagButton,
              currentProgress?.flagged && styles.flagButtonActive,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text
              style={[
                styles.flagButtonText,
                currentProgress?.flagged && styles.flagButtonTextActive,
              ]}
            >
              {currentProgress?.flagged ? '⚑ Unflag this item' : '⚐ Flag for review'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  loadingText: {
    fontSize: 15,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  briefingContainer: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 20,
    justifyContent: 'center',
  },
  briefingCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 16,
    ...shadows.card,
  },
  briefingBadge: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.full,
    alignSelf: 'flex-start',
  },
  briefingBadgeText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  briefingTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  briefingSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  ruleList: {
    gap: 10,
    paddingVertical: 6,
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ruleBullet: {
    fontSize: 18,
  },
  ruleText: {
    fontSize: 14,
    color: colors.textSecondary,
    flex: 1,
  },
  startExamButton: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: radii.md,
    alignItems: 'center',
    marginTop: 8,
    ...shadows.subtle,
  },
  startExamButtonText: {
    color: colors.textInverted,
    fontWeight: '700',
    fontSize: 16,
  },
  examHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  subjectChip: {
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.full,
  },
  subjectChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.brandNavy,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  timerBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  timerBoxWarning: {
    backgroundColor: colors.warningLight,
    borderColor: colors.warningBorder,
  },
  timerBoxCritical: {
    backgroundColor: colors.dangerLight,
    borderColor: colors.dangerBorder,
  },
  timerIcon: {
    fontSize: 14,
  },
  timerText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  timerTextWarning: {
    color: colors.warning,
  },
  timerTextCritical: {
    color: colors.danger,
  },
  paletteWrapper: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 8,
  },
  palette: {
    flexGrow: 0,
  },
  paletteContent: {
    gap: 8,
    paddingHorizontal: 16,
  },
  paletteCell: {
    width: 38,
    height: 38,
    borderRadius: radii.sm,
    borderWidth: 1.5,
    borderColor: colors.borderDark,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  paletteCellAnswered: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  paletteCellFlagged: {
    borderColor: colors.warning,
    borderWidth: 2,
  },
  paletteCellCurrent: {
    borderColor: colors.primary,
    borderWidth: 2.5,
    backgroundColor: colors.primaryLight,
  },
  paletteCellText: {
    fontWeight: '700',
    fontSize: 13,
    color: colors.textPrimary,
  },
  paletteCellTextAnswered: {
    color: colors.textInverted,
  },
  paletteCellTextCurrent: {
    color: colors.primaryDark,
  },
  flagDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.warning,
  },
  questionScroll: {
    flex: 1,
  },
  questionContent: {
    padding: 16,
    gap: 14,
    paddingBottom: 32,
  },
  stemCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
    ...shadows.subtle,
  },
  stemHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  questionNumberLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  flaggedChip: {
    backgroundColor: colors.warningLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radii.xs,
  },
  flaggedChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.warning,
  },
  stem: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    lineHeight: 24,
  },
  optionsList: {
    gap: 10,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: 14,
    gap: 12,
    ...shadows.subtle,
  },
  optionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  optionCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.borderDark,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  optionCircleSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  optionCircleText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  optionCircleTextSelected: {
    color: colors.textInverted,
  },
  optionText: {
    fontSize: 15,
    color: colors.textPrimary,
    flex: 1,
    lineHeight: 21,
  },
  optionTextSelected: {
    color: colors.primaryDark,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  flagButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderDark,
    backgroundColor: colors.surface,
  },
  flagButtonActive: {
    backgroundColor: colors.warningLight,
    borderColor: colors.warningBorder,
  },
  flagButtonText: {
    color: colors.textSecondary,
    fontWeight: '600',
    fontSize: 14,
  },
  flagButtonTextActive: {
    color: colors.warning,
  },
  buttonPressed: {
    opacity: 0.85,
  },
});
