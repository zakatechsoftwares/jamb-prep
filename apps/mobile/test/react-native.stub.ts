type ChildrenProps = { children?: unknown };

export function View(_props: ChildrenProps) {
  return null;
}

export function Text(_props: ChildrenProps) {
  return null;
}

export function Pressable(_props: ChildrenProps) {
  return null;
}

export function ScrollView(_props: ChildrenProps) {
  return null;
}

export const StyleSheet = {
  create<T extends Record<string, unknown>>(styles: T): T {
    return styles;
  },
};
