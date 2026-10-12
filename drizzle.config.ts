import { defineConfig } from 'drizzle-kit';

// Platform-owned (plan 06 §7.3, A3.5/A3.8): `npm run db:generate` diffs src/db/schema.ts against the
// last snapshot in drizzle/meta — offline, no credentials. Always the `sqlite` dialect, D1 or Turso:
// Turso is libSQL (SQLite), and drizzle-kit's `turso` dialect writes `ALTER COLUMN` (which SQLite and
// the D1 half of the pipeline refuse) and quotes expression indexes into broken SQL (research 72
// p0mig), so the drizzle/ folder never depends on the provider. `drizzle-kit push/pull/studio/
// migrate` need a direct connection and are not available against a Totalum database.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
});
