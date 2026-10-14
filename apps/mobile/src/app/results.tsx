import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { scoreExam, type ScoreResult } from '@jamb/shared';
import { loadScoringAttempts } from '../lib/database';
import { DEMO_EXAM_CONFIG, DEMO_SUBJECTS } from '../lib/demo-fixture';
import { colors, radii, shadows } from '../theme';

function subjectName(subjectId: number): string {
  return (
    DEMO_SUBJECTS.find((subject) => subject.subjectId === subjectId)?.name ??
    `Subject ${subjectId}`
  );
}

export default function ResultsScreen() {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  const [score, setScore] = useState<ScoreResult | null>(null);

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
        <Text style={styles.loadingText}>Computing verified scores…</Text>
      </View>
    );
  }

  const scorePct = Math.round((score.aggregateScore / score.aggregateMaxMarks) * 100);
  const isCompetitive = score.aggregateScore >= 250;
  const isPassing = score.aggregateScore >= 200 && !isCompetitive;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      {/* Hero Score Banner */}
      <View style={styles.heroCard}>
        <View style={styles.badgeRow}>
          <View style={styles.examTag}>
            <Text style={styles.examTagText}>OFFICIAL CBT SIMULATION RESULT</Text>
          </View>
        </View>

        <View style={styles.scoreCircle}>
          <Text style={styles.aggregateScoreText}>{score.aggregateScore}</Text>
          <Text style={styles.aggregateMaxText}>/ {score.aggregateMaxMarks}</Text>
        </View>

        <View
          style={[
            styles.statusPill,
            isCompetitive && styles.statusPillCompetitive,
            isPassing && styles.statusPillPassing,
          ]}
        >
          <Text
            style={[
              styles.statusPillText,
              isCompetitive && styles.statusPillTextCompetitive,
              isPassing && styles.statusPillTextPassing,
            ]}
          >
            {isCompetitive
              ? '🌟 High Competitive Tier'
              : isPassing
                ? '✓ Eligible For Most Tertiary Programs'
                : '📈 Good Attempt — Target Weak Subjects'}
          </Text>
        </View>

        <Text style={styles.heroNote}>
          Scored in accordance with official JAMB consolidation rules with zero negative marking.
        </Text>
      </View>

      {/* Subject Breakdown Card */}
      <View style={styles.breakdownCard}>
        <Text style={styles.sectionTitle}>Subject Performance Breakdown</Text>

        <View style={styles.subjectList}>
          {score.subjectScores.map((subjectScore) => {
            const subjectPct = Math.round(
              subjectScore.maxMarks > 0
                ? (subjectScore.score / subjectScore.maxMarks) * 100
                : 0,
            );
            const isHigh = subjectPct >= 60;
            const isMid = subjectPct >= 50 && !isHigh;

            return (
              <View key={subjectScore.subjectId} style={styles.subjectRow}>
                <View style={styles.subjectRowHeader}>
                  <Text style={styles.subjectTitle}>
                    {subjectName(subjectScore.subjectId)}
                  </Text>
                  <Text style={styles.subjectScore}>
                    <Text style={styles.subjectScoreValue}>{subjectScore.score}</Text>
                    <Text style={styles.subjectScoreMax}> / {subjectScore.maxMarks}</Text>
                  </Text>
                </View>

                {/* Progress bar */}
                <View style={styles.progressBarBg}>
                  <View
                    style={[
                      styles.progressBarFill,
                      { width: `${subjectPct}%` },
                      isHigh && styles.barFillHigh,
                      isMid && styles.barFillMid,
                    ]}
                  />
                </View>
              </View>
            );
          })}
        </View>
      </View>

      {/* Summary Stats */}
      <View style={styles.statsCard}>
        <View style={styles.statCol}>
          <Text style={styles.statLabel}>Aggregate Accuracy</Text>
          <Text style={styles.statValue}>{scorePct}%</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statCol}>
          <Text style={styles.statLabel}>Subjects Tested</Text>
          <Text style={styles.statValue}>{score.subjectScores.length}</Text>
        </View>
      </View>

      {/* Action Navigation */}
      <Pressable
        onPress={() => router.replace('/')}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      >
        <Text style={styles.buttonText}>Back to Home Dashboard</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    padding: 16,
    gap: 16,
    paddingBottom: 32,
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
  heroCard: {
    backgroundColor: colors.brandNavy,
    borderRadius: radii.xl,
    padding: 24,
    alignItems: 'center',
    gap: 14,
    ...shadows.card,
  },
  badgeRow: {
    flexDirection: 'row',
  },
  examTag: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.full,
  },
  examTagText: {
    color: '#93c5fd',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  scoreCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  aggregateScoreText: {
    fontSize: 54,
    fontWeight: '900',
    color: colors.textInverted,
    letterSpacing: -1,
  },
  aggregateMaxText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#94a3b8',
    marginTop: -4,
  },
  statusPill: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radii.full,
  },
  statusPillCompetitive: {
    backgroundColor: 'rgba(16, 185, 129, 0.25)',
  },
  statusPillPassing: {
    backgroundColor: 'rgba(59, 130, 246, 0.25)',
  },
  statusPillText: {
    color: '#fef08a',
    fontSize: 13,
    fontWeight: '700',
  },
  statusPillTextCompetitive: {
    color: '#6ee7b7',
  },
  statusPillTextPassing: {
    color: '#93c5fd',
  },
  heroNote: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 17,
  },
  breakdownCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 14,
    ...shadows.subtle,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  subjectList: {
    gap: 14,
  },
  subjectRow: {
    gap: 6,
  },
  subjectRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  subjectTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  subjectScore: {
    fontSize: 14,
  },
  subjectScoreValue: {
    fontWeight: '800',
    color: colors.textPrimary,
  },
  subjectScoreMax: {
    color: colors.textMuted,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.full,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.warning,
    borderRadius: radii.full,
  },
  barFillHigh: {
    backgroundColor: colors.success,
  },
  barFillMid: {
    backgroundColor: colors.primary,
  },
  statsCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    ...shadows.subtle,
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  statLabel: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '500',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: colors.border,
  },
  button: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: radii.md,
    alignItems: 'center',
    marginTop: 6,
    ...shadows.subtle,
  },
  buttonText: {
    color: colors.textInverted,
    fontWeight: '700',
    fontSize: 16,
  },
  buttonPressed: {
    opacity: 0.85,
  },
});
