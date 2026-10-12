import { pathToFileURL } from 'node:url';

import { totalumD1 } from 'totalum-sdk/d1';
import type { D1Database } from 'totalum-sdk/d1';

// `npm run db:sql -- "<sql>" [--param <value>]… [--limit N] [--env dev|live] [--local] [--user-asked]` and
// `npm run db:sql -- --schema` (plan 06 §5, A5.25): one parameterised statement on the project database, one JSON row
// per line. `--schema` prints what the database actually contains. Schema changes are `db:generate` + `db:migrate`:
// SDK-API refuses DDL here. A write that may touch rows the agent did not create is refused (`writeRefusal`, H5).
// `--local` is the local D1 of `npm run dev`. Platform-owned.

export const SCHEMA_SQL = `SELECT type, name, tbl_name AS "table", sql FROM sqlite_master WHERE sql IS NOT NULL
  AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY tbl_name, type DESC, name`;

const AUTH_TABLES = new Set(['users', 'sessions', 'accounts', 'verifications']);
/** The address marker the agent docs give test users (`delivered+agent-test-<n>@resend.dev`). */
export const TEST_MARKER = 'agent-test';
export const OWNER_FLAG = '--user-asked';
const HOW = `the dev database is the preview the owner uses, not a scratch copy. Change or delete only the rows your test created: by id (\`… WHERE id IN (?, ?)\` --param <id>…) or by your marker (e-mail ${TEST_MARKER}…); a test user: \`DELETE FROM users WHERE id = ?\` (its sessions and accounts go with it). Only when the user's prompt asked for this change: add ${OWNER_FLAG}`;

/**
 * H5 (nightly 36960462546): cleaning up its tests, the agent emptied the owner's tables (`DELETE FROM users`,
 * `DELETE FROM sessions`, `… WHERE email IN (<the owner's address>)`). The refusal for a statement that may change
 * rows it did not create, else `null`: DROP (schema goes through migrations); an UPDATE/DELETE without a WHERE that
 * compares a column to a value (`= ?`, `IN ('a', 'b')`, `LIKE 'x%'`; not `1 = 1`, `!=`, `NOT IN` or a subquery); on
 * the auth tables, one that names no id and whose addresses are not all test addresses. `userAsked` (the flag)
 * lifts all but DROP.
 */
export function writeRefusal(sql: string, userAsked = false): string | null {
  const strings: string[] = [];
  let shape = sql
    .replace(/'(?:[^']|'')*'/g, (m) => `'${String(strings.push(m.toLowerCase()) - 1)}'`)
    .replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
    .replace(
      /"([^"]*)"|`([^`]*)`|\[([^\]]*)\]/g,
      (_, a?: string, b?: string, c?: string) => a ?? b ?? c ?? '',
    )
    .toLowerCase()
    .replace(/\s+/g, ' ');
  // parentheses inside out: a value list becomes «v», anything with a SELECT «q»
  while (/\([^()]*\)/.test(shape))
    shape = shape.replace(/\([^()]*\)/g, (m) => (/\bselect\b|«q»/.test(m) ? '«q»' : '«v»'));
  for (const statement of shape.split(';')) {
    const st = statement.trim();
    if (/^drop\b|^alter table [\w.]+ drop\b/.test(st))
      return 'db:sql refused: DROP. Schema changes go through db:generate + db:migrate (_system-docs/database.md)';
    if (userAsked) continue;
    const m = /^(?:with .*? )?(?:delete from|update(?: or \w+)?) (?!set\b)([\w.]+)(.*)$/.exec(st);
    if (!m) continue;
    const table = m[1].replace(/^main\./, '');
    const where = /\bwhere\b(.*?)(?:\breturning\b|\border by\b|\blimit\b|$)/.exec(m[2])?.[1];
    const scoped = [...(where ?? '').matchAll(/([a-z_][\w.]*) ?(?:==?|in|like|glob) ?(\?|'\d+'|-?\d|«v»)/g)]
      .filter(([, col]) => !['not', 'and', 'or', 'where'].includes(col))
      .filter(([, , v]) => !(v.startsWith("'") && /^'[%_]*'$/.test(strings[Number(v.slice(1, -1))] ?? '')))
      .map(([, col]) => col.split('.').pop() ?? '');
    if (!scoped.length)
      return `db:sql refused: an UPDATE/DELETE on ${table} without a WHERE that names the rows; ${HOW}`;
    const literals = [...(where ?? '').matchAll(/'(\d+)'/g)].map((l) => strings[Number(l[1])] ?? '');
    const testOnly = literals.length > 0 && literals.every((l) => l.includes(TEST_MARKER));
    if (AUTH_TABLES.has(table) && !scoped.some((c) => c === 'id' || c === 'user_id') && !testOnly)
      return `db:sql refused: ${table} holds the owner's and real users' sign-ins; ${HOW}`;
  }
  return null;
}

/**
 * F1 (final gate 2026-10-02): the agent listed every note and deleted each by id, the owner's too — a shape the guard
 * passes. Totalum now puts back, at the run's end, every dev row that was there before the run, unless a
 * `${OWNER_FLAG}` statement of the run names its table. What a DELETE without the flag is told, else `null`.
 */
export const deleteNote = (sql: string, userAsked = false) =>
  !userAsked && /^\s*(?:with\b[\s\S]*?\)\s*)?delete\b/i.test(sql)
    ? `note: done. A row that was in the database before this run comes back when the run ends; rows this run created stay deleted (test cleanup is complete). Only if the user's prompt asked for this delete, run it again with ${OWNER_FLAG} (never for test cleanup).`
    : null;

export async function runSql(db: D1Database, sql: string, params: string[] = [], limit = 50) {
  const { results } = await db
    .prepare(sql)
    .bind(...params)
    .all();
  return { rows: results.slice(0, Math.min(Math.max(limit, 1), 1000)), total: results.length };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args.splice(i, 2)[1];
  };
  const params: string[] = [];
  for (let p = flag('--param'); p !== undefined; p = flag('--param')) params.push(p);
  const limit = Number(flag('--limit') ?? 50);
  const env = flag('--env') as 'dev' | 'live' | undefined;
  const local = args.includes('--local');
  const userAsked = args.includes(OWNER_FLAG);
  const schema = args.includes('--schema');
  const sql = schema ? SCHEMA_SQL : args.find((a) => !a.startsWith('--'));
  const proxy = local
    ? await (await import('wrangler')).getPlatformProxy<{ TOTALUM_DB: D1Database }>({ envFiles: [] })
    : undefined;
  try {
    if (!sql)
      throw new Error(
        `usage: npm run db:sql -- "SELECT …" [--param v]… [--limit N] [${OWNER_FLAG}] | --schema`,
      );
    const refusal = writeRefusal(sql, userAsked);
    if (refusal) throw new Error(refusal);
    const { rows, total } = await runSql(proxy?.env.TOTALUM_DB ?? totalumD1({ env }), sql, params, limit);
    for (const row of rows) console.log(schema ? `${String(row.sql)};` : JSON.stringify(row));
    console.log(
      `(${String(total)} row${total === 1 ? '' : 's'}${total > rows.length ? `, ${String(rows.length)} shown` : ''})`,
    );
    const note = !local && (env ?? process.env.TOTALUM_ENV) !== 'live' ? deleteNote(sql, userAsked) : null;
    if (note) console.log(note);
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : '';
    console.error(`db:sql failed: ${err instanceof Error ? err.message : String(err)}${cause}`);
    process.exitCode = 1;
  } finally {
    await proxy?.dispose();
  }
}
