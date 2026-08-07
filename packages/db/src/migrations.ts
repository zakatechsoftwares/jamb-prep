import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const migrationsDir = path.resolve(__dirname, '../migrations');

export interface Migration {
  name: string;
  upPath: string;
  downPath: string;
}

export function loadMigrations(dir: string = migrationsDir): Migration[] {
  const names = readdirSync(dir)
    .filter((file) => file.endsWith('.up.sql'))
    .map((file) => file.replace(/\.up\.sql$/, ''))
    .sort();

  return names.map((name) => ({
    name,
    upPath: path.join(dir, `${name}.up.sql`),
    downPath: path.join(dir, `${name}.down.sql`),
  }));
}
