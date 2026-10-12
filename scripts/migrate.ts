import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { drizzle } from 'drizzle-orm/d1';
import { migrate } from 'drizzle-orm/d1/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { isTotalumError, totalumD1 } from 'totalum-sdk/d1';

// `npm run db:migrate [folder]` (plan 06 §7.3, plan 09 §3.3, A3.5): the hash pre-check Drizzle's migrator
// lacks, then Drizzle's own `migrate()` — the only migration code in a project. Runs wherever Node runs with
// only the project key: `totalumD1({ mode: 'migrate' })` speaks HTTPS to SDK-API from TOTALUM_PROJECT_KEY
// (+ TOTALUM_ENV, TOTALUM_SDK_API_URL). `--local` migrates the local D1 (Miniflare, `.wrangler/`) instead, with no
// key and no network: the one `npm run dev` uses on a project without a dev database.

const MIGRATIONS_TABLE = '_migrations';

// Frozen in @speed-paradigm/totalum-contracts `ERROR_CODES`. A customer project cannot depend on that
// private package (`npm ci` from a clean checkout, plan 06 §1), so the two literals are repeated here;
// plan 19 §17.5 asserts them byte-identical across repositories.
export const MIGRATION_EDITED = 'MIGRATION_EDITED';
export const MIGRATION_UNKNOWN_IN_DB = 'MIGRATION_UNKNOWN_IN_DB';

export class MigrationPreflightError extends Error {
  constructor(
    readonly code: typeof MIGRATION_EDITED | typeof MIGRATION_UNKNOWN_IN_DB,
    message: string,
  ) {
    super(message);
    this.name = 'MigrationPreflightError';
  }
}

/**
 * Hash pre-check: every ledger row must match, by `created_at == when`, a journal entry whose file still
 * hashes to the ledger `hash`. Reads only; nothing is sent to the database on failure.
 */
export async function preflightMigrations(
  db: D1Database,
  env: string,
  migrationsFolder: string,
): Promise<void> {
  const ledgerExists = await db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .bind(MIGRATIONS_TABLE)
    .first();
  if (!ledgerExists) return;

  const { entries } = JSON.parse(readFileSync(`${migrationsFolder}/meta/_journal.json`, 'utf8')) as {
    entries: { tag: string }[];
  };
  const files = readMigrationFiles({ migrationsFolder }); // journal order, hash = sha256(file), as Drizzle computes it
  const { results } = await db
    .prepare(`SELECT hash, created_at FROM "${MIGRATIONS_TABLE}"`)
    .all<{ hash: string; created_at: number }>();

  for (const row of results) {
    const index = files.findIndex((f) => f.folderMillis === row.created_at);
    if (index === -1) {
      throw new MigrationPreflightError(
        MIGRATION_UNKNOWN_IN_DB,
        `${env} has a migration (created_at ${String(row.created_at)}) this checkout does not know; pull/merge before migrating`,
      );
    }
    if (files[index]?.hash !== row.hash) {
      throw new MigrationPreflightError(
        MIGRATION_EDITED,
        `drizzle/${entries[index]?.tag ?? String(index)}.sql was changed after being applied to ${env}; create a new migration instead`,
      );
    }
  }
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

/**
 * Foreign-key columns that no index starts with, as `table.column` (research 46 §5.2). SQLite never indexes the child
 * side of a foreign key, and D1 enforces them: deleting one parent row then scans every child table while the
 * database's single writer waits (a user delete took 938 ms on a 350,000-row app; 19 ms with the indexes).
 * PRAGMA statements, because D1 refuses the `pragma_*()` table functions.
 */
export async function unindexedForeignKeys(db: D1Database): Promise<string[]> {
  const { results: tables } = await db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
         AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE '\\_\\_turso\\_%' ESCAPE '\\'`,
    )
    .all<{ name: string }>();
  if (tables.length === 0) return [];
  const lists = await db.batch<{ from?: string; seq?: number; name?: string }>(
    tables.flatMap((t) => [
      db.prepare(`PRAGMA foreign_key_list(${quote(t.name)})`),
      db.prepare(`PRAGMA index_list(${quote(t.name)})`),
    ]),
  );
  const indexes = tables.flatMap((t, i) =>
    (lists[2 * i + 1]?.results ?? []).map((ix) => ({ table: t.name, index: String(ix.name) })),
  );
  const infos = indexes.length
    ? await db.batch<{ seqno: number; name: string }>(
        indexes.map((ix) => db.prepare(`PRAGMA index_info(${quote(ix.index)})`)),
      )
    : [];
  const leading = new Set(
    indexes.map((ix, i) => `${ix.table}.${String(infos[i]?.results.find((c) => c.seqno === 0)?.name)}`),
  );
  return tables
    .flatMap((t, i) =>
      (lists[2 * i]?.results ?? [])
        .filter((fk) => fk.seq === 0 && !leading.has(`${t.name}.${String(fk.from)}`))
        .map((fk) => `${t.name}.${String(fk.from)}`),
    )
    .sort();
}

/**
 * sefix SE3 (`npm run check` and `build:preview`): a migration file a database already applied is never edited, renamed
 * or deleted — a run rewrote one that live had applied to `SELECT 1;`, and every later import and publish of the
 * project failed `MIGRATION_EDITED`. Reads each database's ledger only; answers the refusal the agent reads, else `null`.
 */
export async function appliedMigrationsRefusal(
  dbs: { env: string; db: D1Database }[],
  migrationsFolder = './drizzle',
): Promise<string | null> {
  for (const { env, db } of dbs) {
    try {
      await preflightMigrations(db, env, migrationsFolder);
    } catch (err) {
      if (!(err instanceof MigrationPreflightError)) continue; // an unreachable database is not this check's to judge
      const where = env === 'live' ? 'the live (published) database' : `the ${env} database`;
      return err.code === MIGRATION_EDITED
        ? `${err.code}: ${err.message.replace(/ was changed after being applied to .*$/, '')} was already applied to ${where} and has been changed. Put it back exactly as it was when it was applied (\`git log -p -- <file>\` shows it) and never edit, rename or delete an applied migration: make any further change in a new migration (\`npm run db:generate\`).`
        : `${err.code}: ${where} applied a migration (${err.message.match(/created_at \d+/)?.[0] ?? ''}) that drizzle/ no longer has. Put the deleted or renamed migration file and its journal entry back as they were (\`git log --stat -- drizzle/\`), and make any change in a new migration (\`npm run db:generate\`).`;
    }
  }
  return null;
}

/** Pre-check, then Drizzle applies every journal entry newer than the last `_migrations` row in one batch. */
export async function migrateProject(
  db: D1Database,
  env: string,
  migrationsFolder = './drizzle',
): Promise<void> {
  await preflightMigrations(db, env, migrationsFolder);
  await migrate(drizzle(db), { migrationsFolder, migrationsTable: MIGRATIONS_TABLE });
}

/**
 * O3 (2026-10-08): the database `npm run db:migrate` changes. `TOTALUM_ENV` (`dev` or `live`) when set; unset, never live
 * by default: a project with a dev database is refused until `.env` names one, and a live-only project (SDK-API answers
 * `DEV_DATABASE_NOT_FOUND` for its dev database) has only live to migrate.
 */
export async function targetEnv(): Promise<'dev' | 'live'> {
  const named = process.env['TOTALUM_ENV'];
  if (named === 'dev' || named === 'live') return named;
  if (named) throw new Error(`TOTALUM_ENV must be dev or live, not "${named}"`);
  try {
    await totalumD1({ env: 'dev' }).prepare('SELECT 1').first();
  } catch (err) {
    if (isTotalumError(err) && err.errorCode === 'DEV_DATABASE_NOT_FOUND') return 'live';
    throw err;
  }
  throw new Error(
    'TOTALUM_ENV is not set and this project has a dev database: add TOTALUM_ENV=dev to .env (or TOTALUM_ENV=live to migrate the published database)',
  );
}

const cli = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
const cliArgs = process.argv.slice(2);
if (cli && cliArgs.includes('--check-applied')) {
  // the agent's check (`build-preview.mjs`): read-only, the project's dev and live ledgers; no key (a laptop): nothing
  const refusal = process.env['TOTALUM_PROJECT_KEY']
    ? await appliedMigrationsRefusal(
        (['dev', 'live'] as const).map((e) => ({ env: e, db: totalumD1({ env: e }) })),
      )
    : null;
  if (refusal) {
    console.error(refusal);
    process.exitCode = 1;
  }
} else if (cli) {
  const args = cliArgs;
  // `--dev-server` (`npm run dev`'s first step): the database `npm run dev` serves (`next.config.ts`) — the dev database
  // when the project has one, else the local D1; `.env` read as `next dev` reads it (a laptop; set variables win)
  // (`npm run db:migrate` on a laptop reads the downloaded `.env` too)
  if (existsSync('.env')) process.loadEnvFile('.env');
  const devDatabase = process.env['TOTALUM_ENV'] === 'dev' && !!process.env['TOTALUM_PROJECT_KEY'];
  const local = args.includes('--local') || (args.includes('--dev-server') && !devDatabase);
  const proxy = local
    ? await (await import('wrangler')).getPlatformProxy<{ TOTALUM_DB: D1Database }>({ envFiles: [] })
    : undefined;
  let env = 'local';
  try {
    if (!local) env = await targetEnv();
    // `-- --destructive`: only when the user explicitly asked to drop/rename (A10.4, A10.7 (2)); SDK-API still needs
    // the run's confirmation flag for the agent
    // `--local` goes through the same migrate rules as the pipeline (research 72): what the preview's migration refuses
    // (FTS5, an unconfirmed drop or rename) is refused here too, and drizzle-kit's table rebuild keeps the child rows
    const destructive = args.includes('--destructive');
    const db = proxy
      ? totalumD1({ binding: proxy.env.TOTALUM_DB, mode: 'migrate', destructive })
      : totalumD1({ env: env as 'dev' | 'live', mode: 'migrate', destructive });
    await migrateProject(
      db,
      env,
      args.find((a) => !a.startsWith('--')),
    );
    console.log(`db:migrate: ${env} is up to date`);
    for (const column of await unindexedForeignKeys(db))
      console.warn(
        `db:migrate: warning: ${column} is a foreign key without an index; add one (index('<name>').on(<column>)) in src/db/schema.ts and generate a migration`,
      );
  } catch (err) {
    // one line, no stack: the agent reads the cause, not Node's internals (research 39 §7.2)
    const code = err instanceof MigrationPreflightError ? `${err.code}: ` : '';
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : '';
    console.error(`db:migrate failed: ${code}${err instanceof Error ? err.message : String(err)}${cause}`);
    process.exitCode = 1;
  } finally {
    await proxy?.dispose();
  }
}
