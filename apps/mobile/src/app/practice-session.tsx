import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { OptionLabel } from '@jamb/shared';
import { usePractice } from '../hooks/usePractice';
import { colors, radii, shadows } from '../theme';

/**
 * Practice mode (plan 6.1) — stem, four options, submit, immediate
 * correct/incorrect plus explanation. A question palette and Previous/Next
 * move freely (skipping allowed; answered questions are review-only), and
 * the session ends on Finish or Change subject. Every rule here comes from
 * @jamb/shared's practice-session-reducer via usePractice (rule 7).
 */
export default function PracticeSessionScreen() {
  const router = useRouter();
  const { subjectId } = useLocalSearchParams<{ subjectId: string }>();
  const practice = usePractice();
  const [confirmingFinish, setConfirmingFinish] = useState(false);

  function requestFinish() {
    if (practice.summary.unanswered > 0) {
      setConfirmingFinish(true);
      return;
    }
    practice.finish();
  }

  function changeSubject() {
    // Every submitted answer is already recorded; ending the session here
    // lets it sync, then the candidate picks another subject.
    practice.finish();
    router.replace('/practice');
  }

  useEffect(() => {
    const parsed = subjectId ? Number(subjectId) : NaN;
    if (Number.isInteger(parsed)) {
      void practice.start(parsed);
    }
  }, [subjectId]);

  if (practice.startError) {
    return (
      <View style={styles.center}>
        <View style={styles.feedbackCard}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>Unable to Start Session</Text>
          <Text style={styles.error}>{practice.startError}</Text>
          <Pressable
            onPress={() => router.replace('/practice')}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
          >
            <Text style={styles.primaryButtonText}>Back to Subjects</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (practice.phase === 'finished') {
    const { correct, answered, unanswered } = practice.summary;
    const percentage = Math.round(answered > 0 ? (correct / answered) * 100 : 0);

    return (
      <View style={styles.center}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryEmoji}>{percentage >= 70 ? '🎉' : '📚'}</Text>
          <Text style={styles.summaryTitle}>Practice Session Complete!</Text>
          <View style={styles.scorePill}>
            <Text style={styles.summary}>
              {correct} / {answered}
            </Text>
            <Text style={styles.summaryPercent}>({percentage}%)</Text>
          </View>
          {unanswered > 0 && (
            <Text style={styles.summaryFeedback}>
              {unanswered} {unanswered === 1 ? 'question was' : 'questions were'} left unanswered.
            </Text>
          )}
          <Text style={styles.summaryFeedback}>
            {percentage >= 70
              ? 'Great mastery! Keep up the momentum for your UTME preparation.'
              : 'Consistent practice makes permanent. Review your weak areas and try again!'}
          </Text>
          <Pressable
            onPress={() => router.replace('/practice')}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
          >
            <Text style={styles.primaryButtonText}>Back to Subjects</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const item = practice.currentItem;
  if (!item) {
    return (
      <View style={styles.center}>
        <Text style={styles.loadingText}>Loading question…</Text>
      </View>
    );
  }

  const correctLabel = item.options.find((option) => option.isCorrect)?.label;
  const progressFraction =
    practice.totalItems > 0 ? practice.summary.answered / practice.totalItems : 0;

  return (
    <View style={styles.screen}>
      {/* Top Progress Track */}
      <View style={styles.progressContainer}>
        <View style={styles.progressInfoRow}>
          <Text style={styles.progressText}>
            Question {practice.currentIndex + 1} of {practice.totalItems}
          </Text>
          <Text style={styles.liveScoreBadge}>
            {practice.summary.correct} correct · {practice.summary.answered} answered
          </Text>
        </View>
        <View style={styles.progressBarBackground}>
          <View
            style={[styles.progressBarFill, { width: `${Math.round(progressFraction * 100)}%` }]}
          />
        </View>
      </View>

      {/* Question palette: green correct, red wrong, outlined current */}
      <View style={styles.paletteWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.paletteContent}
        >
          {practice.answers.map((answer, index) => {
            const isCurrent = index === practice.currentIndex;
            return (
              <Pressable
                key={index}
                accessibilityLabel={`Question ${index + 1}`}
                onPress={() => practice.goTo(index)}
                style={[
                  styles.paletteCell,
                  answer?.isCorrect === true && styles.paletteCellCorrect,
                  answer?.isCorrect === false && styles.paletteCellWrong,
                  isCurrent && styles.paletteCellCurrent,
                ]}
              >
                <Text
                  style={[
                    styles.paletteCellText,
                    answer !== null && !isCurrent && styles.paletteCellTextInverted,
                  ]}
                >
                  {index + 1}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Stem Card */}
        <View style={styles.stemCard}>
          <Text style={styles.stem}>{item.stem}</Text>
        </View>

        {/* Options */}
        <View style={styles.options}>
          {item.options.map((option) => {
            const isSelected = practice.selected === option.label;
            const isCorrectOption = practice.revealed && option.label === correctLabel;
            const isWrongSelected =
              practice.revealed && isSelected && option.label !== correctLabel;

            return (
              <Pressable
                key={option.label}
                onPress={() => practice.selectOption(option.label as OptionLabel)}
                disabled={practice.revealed}
                style={({ pressed }) => [
                  styles.option,
                  isSelected && !practice.revealed && styles.optionSelected,
                  isCorrectOption && styles.optionCorrect,
                  isWrongSelected && styles.optionWrong,
                  pressed && !practice.revealed && styles.buttonPressed,
                ]}
              >
                <View
                  style={[
                    styles.optionBadge,
                    isSelected && !practice.revealed && styles.optionBadgeSelected,
                    isCorrectOption && styles.optionBadgeCorrect,
                    isWrongSelected && styles.optionBadgeWrong,
                  ]}
                >
                  <Text
                    style={[
                      styles.optionBadgeText,
                      isSelected && !practice.revealed && styles.optionBadgeTextSelected,
                      (isCorrectOption || isWrongSelected) && styles.optionBadgeTextInverted,
                    ]}
                  >
                    {isCorrectOption ? '✓' : isWrongSelected ? '✗' : option.label}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.optionText,
                    isSelected && !practice.revealed && styles.optionTextSelected,
                    isCorrectOption && styles.optionTextCorrect,
                    isWrongSelected && styles.optionTextWrong,
                  ]}
                >
                  {option.text}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Explanation Callout Box */}
        {practice.revealed && (
          <View style={styles.explanationBox}>
            <View style={styles.explanationHeaderRow}>
              <Text style={styles.explanationIcon}>💡</Text>
              <Text style={styles.explanationLabel}>Key Concept & Explanation</Text>
            </View>
            <Text style={styles.explanationBody}>{item.explanation}</Text>
          </View>
        )}

        {/* Submit (unanswered questions only; answered ones are review-only) */}
        {!practice.revealed && (
          <View style={styles.actionContainer}>
            <Pressable
              onPress={() => void practice.submitAnswer()}
              disabled={practice.selected === null}
              style={({ pressed }) => [
                styles.primaryButton,
                practice.selected === null && styles.buttonDisabled,
                pressed && practice.selected !== null && styles.buttonPressed,
              ]}
            >
              <Text style={styles.primaryButtonText}>Submit Answer</Text>
            </Pressable>
          </View>
        )}

        {/* Session controls */}
        {confirmingFinish ? (
          <View style={styles.confirmPanel}>
            <Text style={styles.confirmText}>
              You have {practice.summary.unanswered} unanswered{' '}
              {practice.summary.unanswered === 1 ? 'question' : 'questions'}. Finish anyway?
            </Text>
            <View style={styles.sessionControls}>
              <Pressable
                onPress={() => setConfirmingFinish(false)}
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
              >
                <Text style={styles.secondaryButtonText}>Keep practising</Text>
              </Pressable>
              <Pressable
                onPress={() => practice.finish()}
                style={({ pressed }) => [styles.finishButton, pressed && styles.buttonPressed]}
              >
                <Text style={styles.finishButtonText}>Finish</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.sessionControls}>
            <Pressable
              onPress={changeSubject}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.secondaryButtonText}>Change subject</Text>
            </Pressable>
            <Pressable
              onPress={requestFinish}
              style={({ pressed }) => [styles.finishButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.finishButtonText}>Finish practice</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* Previous / Next — skipping is allowed */}
      <View style={styles.navBar}>
        <Pressable
          accessibilityLabel="Previous question"
          disabled={!practice.canGoPrevious}
          onPress={practice.goPrevious}
          style={({ pressed }) => [
            styles.navButton,
            !practice.canGoPrevious && styles.navButtonDisabled,
            pressed && styles.buttonPressed,
          ]}
        >
          <Text style={[styles.navButtonText, !practice.canGoPrevious && styles.navButtonTextDisabled]}>
            ◀ Previous
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Next question"
          disabled={!practice.canGoNext}
          onPress={practice.goNext}
          style={({ pressed }) => [
            styles.navButton,
            styles.navButtonNext,
            !practice.canGoNext && styles.navButtonDisabled,
            pressed && styles.buttonPressed,
          ]}
        >
          <Text
            style={[
              styles.navButtonText,
              styles.navButtonTextNext,
              !practice.canGoNext && styles.navButtonTextDisabled,
            ]}
          >
            Next ▶
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: colors.background,
  },
  loadingText: {
    fontSize: 15,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  progressContainer: {
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 8,
  },
  progressInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  liveScoreBadge: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.brandEmerald,
    backgroundColor: colors.brandEmeraldLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.full,
  },
  progressBarBackground: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: radii.full,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: radii.full,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
    paddingBottom: 32,
  },
  stemCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.subtle,
  },
  stem: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
    lineHeight: 25,
  },
  options: {
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
  optionCorrect: {
    borderColor: colors.success,
    backgroundColor: colors.successLight,
  },
  optionWrong: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerLight,
  },
  optionBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.borderDark,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  optionBadgeSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  optionBadgeCorrect: {
    borderColor: colors.success,
    backgroundColor: colors.success,
  },
  optionBadgeWrong: {
    borderColor: colors.danger,
    backgroundColor: colors.danger,
  },
  optionBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  optionBadgeTextSelected: {
    color: colors.textInverted,
  },
  optionBadgeTextInverted: {
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
  optionTextCorrect: {
    color: '#15803d',
    fontWeight: '600',
  },
  optionTextWrong: {
    color: '#b91c1c',
  },
  explanationBox: {
    backgroundColor: '#f8fafc',
    borderRadius: radii.lg,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  explanationHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  explanationIcon: {
    fontSize: 16,
  },
  explanationLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  explanationBody: {
    fontSize: 14,
    color: colors.textPrimary,
    lineHeight: 21,
  },
  actionContainer: {
    marginTop: 8,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: radii.md,
    alignItems: 'center',
    ...shadows.subtle,
  },
  buttonDisabled: {
    backgroundColor: colors.borderDark,
  },
  primaryButtonText: {
    color: colors.textInverted,
    fontWeight: '700',
    fontSize: 16,
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    padding: 24,
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: colors.border,
    width: '100%',
    ...shadows.card,
  },
  summaryEmoji: {
    fontSize: 48,
  },
  summaryTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  scorePill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: radii.full,
  },
  summary: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.primary,
  },
  summaryPercent: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  summaryFeedback: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  feedbackCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    padding: 24,
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    width: '100%',
    ...shadows.card,
  },
  errorIcon: {
    fontSize: 36,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.danger,
  },
  error: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  paletteWrapper: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 8,
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
  },
  paletteCellCorrect: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  paletteCellWrong: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
  paletteCellCurrent: {
    borderColor: colors.primary,
    borderWidth: 2.5,
  },
  paletteCellText: {
    fontWeight: '700',
    fontSize: 13,
    color: colors.textPrimary,
  },
  paletteCellTextInverted: {
    color: colors.textInverted,
  },
  sessionControls: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.borderDark,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  finishButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.brandEmerald,
    backgroundColor: colors.brandEmeraldLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  finishButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.brandEmerald,
  },
  confirmPanel: {
    marginTop: 8,
    gap: 4,
    padding: 14,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningLight,
  },
  confirmText: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  navBar: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  navButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.borderDark,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navButtonNext: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  navButtonDisabled: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  navButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  navButtonTextNext: {
    color: colors.textInverted,
  },
  navButtonTextDisabled: {
    color: colors.textMuted,
  },
  buttonPressed: {
    opacity: 0.85,
  },
});
