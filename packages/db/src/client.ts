import { Pool, types } from 'pg';

// int8 (bigint) arrives as a string by default, because a Postgres bigint
// can exceed what a JS number holds exactly. Every id in this schema is a
// BIGSERIAL, so without this every `id: number` in the repository layer is
// a lie that only shows up when something compares one to a real number.
// Parsing to a number is safe here — these are surrogate keys, and 2^53
// rows is not a scale this product reaches — and it makes the declared
// types true. Revisit if a table ever carries genuinely large int8 values.
types.setTypeParser(types.builtins.INT8, (value) => Number(value));

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

// The queue's concurrency tests hold one connection per simultaneous
// caller, so the ceiling has to be liftable without editing code — a pool
// smaller than the concurrency under test blocks on connection acquisition
// and proves nothing about the locking.
const max = Number(process.env.PGPOOL_MAX ?? 10);

// Local Postgres has no SSL listener; a hosted Postgres (Supabase and
// similar) requires one. Explicit opt-in via PGSSL rather than inferring
// from the connection string's host, so this never silently guesses wrong.
// rejectUnauthorized: false is deliberate, not laziness -- Supabase's
// certificate chains through an intermediate CA that Node's default trust
// store does not always carry, a well-documented Supabase+node-postgres
// gotcha; the connection itself is still encrypted, only full chain
// verification is skipped.
const ssl = process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined;

export const pool = new Pool({ connectionString, max, ssl });
