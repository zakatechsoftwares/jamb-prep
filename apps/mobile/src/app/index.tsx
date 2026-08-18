import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { APP_NAME } from '@jamb/shared';

export default function Home() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{APP_NAME}</Text>
      <Text style={styles.subtitle}>Mock CBT demo — offline, fixture content</Text>
      <Pressable onPress={() => router.push('/mock-session')} style={styles.button}>
        <Text style={styles.buttonText}>Go to mock session</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  title: { fontSize: 22, fontWeight: '600' },
  subtitle: { fontSize: 14, color: '#555', textAlign: 'center' },
  button: { backgroundColor: '#1d4ed8', paddingVertical: 14, paddingHorizontal: 28, borderRadius: 8 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
