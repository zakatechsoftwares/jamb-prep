/** Shape-only stub, matching react-native.stub.ts's philosophy: lets database.ts import cleanly under vitest without a real native SQLite module. Never actually persists anything -- no smoke test calls these. */
export async function openDatabaseAsync(_name: string): Promise<unknown> {
  return {
    execAsync: async () => undefined,
    runAsync: async () => ({ lastInsertRowId: 0, changes: 0 }),
    getFirstAsync: async () => null,
    getAllAsync: async () => [],
    withExclusiveTransactionAsync: async (fn: () => Promise<void>) => fn(),
  };
}
