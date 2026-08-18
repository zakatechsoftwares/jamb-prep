import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { OptionLabel } from '@jamb/shared';
import { usePractice } from '../hooks/usePractice';

/**
 * Item-by-item Practice mode (plan 6.1) — stem, four options, submit,
 * immediate correct/incorrect plus explanation, then the next item. No
 * timer, no palette, no subject blueprint: deliberately simpler than the
 * Mock CBT engine (`mock-session.tsx`), which stays untouched.
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
        <Text style={styles.error}>{practice.startError}</Text>
        <Pressable onPress={() => router.replace('/practice')} style={styles.button}>
          <Text style={styles.buttonText}>Back to subjects</Text>
        </Pressable>
      </View>
    );
  }

  if (practice.phase === 'finished') {
    return (
      <View style={styles.center}>
        <Text style={styles.summary}>
          {practice.correctCount} / {practice.totalItems} correct
        </Text>
        <Pressable onPress={() => router.replace('/practice')} style={styles.button}>
          <Text style={styles.buttonText}>Back to subjects</Text>
        </Pressable>
      </View>
    );
  }

  const item = practice.currentItem;
  if (!item) {
    return (
      <View style={styles.center}>
        <Text>Loading…</Text>
      </View>
    );
  }

  const correctLabel = item.options.find((option) => option.isCorrect)?.label;

  return (
    <View style={styles.container}>
      <Text style={styles.progress}>
        {practice.currentIndex + 1} / {practice.totalItems}
      </Text>
      <Text style={styles.stem}>{item.stem}</Text>

      <View style={styles.options}>
        {item.options.map((option) => {
          const isSelected = practice.selected === option.label;
          const isCorrectOption = practice.revealed && option.label === correctLabel;
          const isWrongSelected = practice.revealed && isSelected && option.label !== correctLabel;
          return (
            <Pressable
              key={option.label}
              onPress={() => practice.selectOption(option.label as OptionLabel)}
              disabled={practice.revealed}
              style={[
                styles.option,
                isSelected && !practice.revealed && styles.optionSelected,
                isCorrectOption && styles.optionCorrect,
                isWrongSelected && styles.optionWrong,
              ]}
            >
              <Text style={styles.optionLabel}>{option.label}.</Text>
              <Text style={styles.optionText}>{option.text}</Text>
            </Pressable>
          );
        })}
      </View>

      {practice.revealed && (
        <View style={styles.explanationBox}>
          <Text style={styles.explanationLabel}>Explanation</Text>
          <Text>{item.explanation}</Text>
        </View>
      )}

      {!practice.revealed ? (
        <Pressable
          onPress={() => void practice.submitAnswer()}
          disabled={practice.selected === null}
          style={[styles.button, practice.selected === null && styles.buttonDisabled]}
        >
          <Text style={styles.buttonText}>Submit</Text>
        </Pressable>
      ) : (
        <Pressable onPress={practice.nextItem} style={styles.button}>
          <Text style={styles.buttonText}>
            {practice.currentIndex + 1 >= practice.totalItems ? 'Finish' : 'Next'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  progress: { fontSize: 13, color: '#555' },
  stem: { fontSize: 18, fontWeight: '500' },
  options: { gap: 10 },
  option: {
    flexDirection: 'row',
    gap: 8,
    borderWidth: 2,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
  },
  optionSelected: { borderColor: '#1d4ed8', backgroundColor: '#eff6ff' },
  optionCorrect: { borderColor: '#16a34a', backgroundColor: '#f0fdf4' },
  optionWrong: { borderColor: '#dc2626', backgroundColor: '#fef2f2' },
  optionLabel: { fontWeight: '600' },
  optionText: { flex: 1 },
  explanationBox: { backgroundColor: '#f3f4f6', borderRadius: 8, padding: 12, gap: 4 },
  explanationLabel: { fontSize: 12, fontWeight: '600', color: '#555', textTransform: 'uppercase' },
  summary: { fontSize: 28, fontWeight: '700' },
  error: { fontSize: 14, color: '#dc2626', textAlign: 'center' },
  button: {
    backgroundColor: '#1d4ed8',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: '#9ca3af' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
