import { describe, expect, it } from 'vitest';
import { loadMigrations } from './migrations';

describe('loadMigrations', () => {
  it('pairs every up file with a down file, sorted by name', () => {
    const migrations = loadMigrations();

    expect(migrations.length).toBeGreaterThan(0);

    const names = migrations.map((migration) => migration.name);
    expect(names).toEqual([...names].sort());

    for (const migration of migrations) {
      expect(migration.upPath.endsWith(`${migration.name}.up.sql`)).toBe(true);
      expect(migration.downPath.endsWith(`${migration.name}.down.sql`)).toBe(true);
    }
  });
});
