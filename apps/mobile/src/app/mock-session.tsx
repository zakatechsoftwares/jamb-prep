import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { OptionLabel } from '@jamb/shared';
import { useMockSession } from '../hooks/useMockSession';
import { DEMO_ITEMS, findDemoItem } from '../lib/demo-fixture';

function formatRemaining(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function MockSessionScreen() {
  const router = useRouter();
  const { phase, session, remainingSeconds, sessionId, startSession, selectOption, toggleFlag, navigate } =
    useMockSession();

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
        <Text>Loading…</Text>
      </View>
    );
  }

  if (phase === 'not_started') {
    return (
      <View style={styles.center}>
        <Pressable onPress={() => void startSession()} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Start mock session</Text>
        </Pressable>
      </View>
    );
  }

  if (!session) {
    return null;
  }

  const currentItem = findDemoItem(session.currentItemId);
  const currentProgress = session.progress[session.currentItemId];

  return (
    <View style={styles.container}>
      <Text style={styles.timer}>{formatRemaining(remainingSeconds)}</Text>

      <ScrollView horizontal style={styles.palette} contentContainerStyle={styles.paletteContent}>
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
              <Text style={styles.paletteCellText}>{item.itemId}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={styles.subject}>{currentItem.subjectName}</Text>
      <Text style={styles.stem}>{currentItem.stem}</Text>

      {currentItem.options.map((option) => {
        const isSelected = currentProgress?.selectedOption === option.label;
        return (
          <Pressable
            key={option.label}
            onPress={() => void selectOption(currentItem.itemId, option.label as OptionLabel)}
            style={[styles.option, isSelected && styles.optionSelected]}
          >
            <Text style={styles.optionText}>
              {option.label}. {option.text}
            </Text>
          </Pressable>
        );
      })}

      <Pressable onPress={() => void toggleFlag(currentItem.itemId)} style={styles.flagButton}>
        <Text style={styles.flagButtonText}>
          {currentProgress?.flagged ? 'Unflag this item' : 'Flag for review'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  timer: { fontSize: 28, fontWeight: '700', textAlign: 'center' },
  palette: { flexGrow: 0, maxHeight: 56 },
  paletteContent: { gap: 8, paddingVertical: 4 },
  paletteCell: {
    width: 40,
    height: 40,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ccc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  paletteCellAnswered: { backgroundColor: '#dcfce7', borderColor: '#16a34a' },
  paletteCellFlagged: { borderColor: '#d97706', borderWidth: 2 },
  paletteCellCurrent: { borderColor: '#1d4ed8', borderWidth: 2 },
  paletteCellText: { fontWeight: '600' },
  subject: { fontSize: 13, color: '#555', textTransform: 'uppercase' },
  stem: { fontSize: 17, fontWeight: '500' },
  option: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 },
  optionSelected: { borderColor: '#1d4ed8', backgroundColor: '#eff6ff' },
  optionText: { fontSize: 15 },
  flagButton: { marginTop: 8, alignSelf: 'flex-start' },
  flagButtonText: { color: '#d97706', fontWeight: '600' },
  primaryButton: { backgroundColor: '#1d4ed8', paddingVertical: 14, paddingHorizontal: 28, borderRadius: 8 },
  primaryButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
