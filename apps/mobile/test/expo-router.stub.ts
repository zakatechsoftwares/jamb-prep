/** Shape-only stub, matching react-native.stub.ts's philosophy: lets a screen import cleanly under vitest without a real router. Never actually renders or navigates anything. */
export function Stack(_props: unknown) {
  return null;
}

export function Link(_props: unknown) {
  return null;
}

export function useRouter() {
  return { push: () => undefined, replace: () => undefined, back: () => undefined };
}

export function useLocalSearchParams(): Record<string, string | undefined> {
  return {};
}

/** Never fires under the stub — screens only need it to import cleanly. */
export function useFocusEffect(_effect: () => void | (() => void)): void {
  return undefined;
}
