import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { OptionLabel } from '@jamb/shared';
import { usePractice } from '../hooks/usePractice';
import { colors, radii, shadows } from '../theme';

/**
 * Item-by-item Practice mode (plan 6.1) — stem, four options, submit,
 * immediate correct/incorrect plus explanation, then the next item.
 */
export default function PracticeSessionScreen() {
  const router = useRouter();
  const { subjectId } = useLocalSearchParams<{ subjectId: string }>();
  const practice = usePractice();

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
    const percentage = Math.round(
      practice.totalItems > 0 ? (practice.correctCount / practice.totalItems) * 100 : 0,
    );

    return (
      <View style={styles.center}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryEmoji}>{percentage >= 70 ? '🎉' : '📚'}</Text>
          <Text style={styles.summaryTitle}>Practice Session Complete!</Text>
          <View style={styles.scorePill}>
            <Text style={styles.summary}>
              {practice.correctCount} / {practice.totalItems}
            </Text>
            <Text style={styles.summaryPercent}>({percentage}%)</Text>
          </View>
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
  const progressFraction = (practice.currentIndex + 1) / practice.totalItems;

  return (
    <View style={styles.screen}>
      {/* Top Progress Track */}
      <View style={styles.progressContainer}>
        <View style={styles.progressInfoRow}>
          <Text style={styles.progressText}>
            Question {practice.currentIndex + 1} of {practice.totalItems}
          </Text>
          <Text style={styles.liveScoreBadge}>{practice.correctCount} Correct</Text>
        </View>
        <View style={styles.progressBarBackground}>
          <View
            style={[styles.progressBarFill, { width: `${Math.round(progressFraction * 100)}%` }]}
          />
        </View>
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

        {/* Submit or Next Button */}
        <View style={styles.actionContainer}>
          {!practice.revealed ? (
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
          ) : (
            <Pressable
              onPress={practice.nextItem}
              style={({ pressed }) => [styles.nextButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.nextButtonText}>
                {practice.currentIndex + 1 >= practice.totalItems
                  ? 'Finish Practice →'
                  : 'Next Question →'}
              </Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
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
  nextButton: {
    backgroundColor: colors.brandEmerald,
    paddingVertical: 14,
    borderRadius: radii.md,
    alignItems: 'center',
    ...shadows.subtle,
  },
  nextButtonText: {
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
  buttonPressed: {
    opacity: 0.85,
  },
});
