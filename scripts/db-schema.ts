import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { totalumD1 } from 'totalum-sdk/d1';

// `npm run db:schema -- [--env dev|live] [--table <name>]`: the CURRENT schema of the dev or live database, read-only,
// from SDK-API (`GET /v1/db/schema`): each table's columns (type, NOT NULL, default, references), primary key,
// indexes and CHECKs, then the migrations applied there, matched to `drizzle/` (the ones not applied yet listed as
// pending). Bounded output: 60 tables, 80 columns a table. An expression index (`lower(email)`) has no column names,
// so its key list is read from its CREATE INDEX in `sqlite_master` (one more read, only then). Platform-owned.

interface Column {
  name: string;
  sqlType: string;
  notNull: boolean;
  unique: boolean;
  default: string | null;
  relation?: { table: string; fkColumn: string; onDelete: string };
}
interface Table {
  name: string;
  kind: string;
  columns: Column[];
  primaryKey?: string[];
  indexes: { name: string; columns: (string | null)[]; unique: boolean }[];
  foreignKeys: { column: string; table: string; toColumn: string; onDelete: string }[];
  checks: string[];
}
export interface Schema {
  env: string;
  tables: Table[];
  ledger: { count: number; lastCreatedAt: number | null };
}
type Journal = { tag: string; when: number }[];

const MAX_TABLES = 60;
const MAX_COLUMNS = 80;

/** Indexes keyed (in part) by an expression: SQLite names no column for those keys. */
export const expressionIndexes = (schema: Schema) =>
  schema.tables.flatMap((t) => t.indexes).filter((i) => !i.columns.length || i.columns.some((c) => !c));

/** The key list of a CREATE INDEX: `lower(email)` of `CREATE INDEX x ON t (lower(email)) WHERE …`. */
export function indexKeysOf(sql: string): string | null {
  const on = /\bON\s+(?:`[^`]*`|"[^"]*"|\[[^\]]*\]|[\w.]+)\s*\(/i.exec(sql);
  if (!on) return null;
  const start = on.index + on[0].length;
  let depth = 1;
  for (let i = start; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === '`')
      i = sql.indexOf(ch, i + 1) === -1 ? sql.length : sql.indexOf(ch, i + 1);
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return sql.slice(start, i).trim();
  }
  return null;
}

export function formatSchema(
  schema: Schema,
  journal: Journal,
  only?: string,
  indexSql: Record<string, string> = {},
): string[] {
  const tables = schema.tables.filter((t) => (only ? t.name === only : true));
  const out = [`${schema.env} database: ${String(tables.length)} table${tables.length === 1 ? '' : 's'}`];
  for (const t of tables.slice(0, MAX_TABLES)) {
    out.push('', `${t.name}${t.kind === 'table' ? '' : ` (${t.kind})`}`);
    for (const c of t.columns.slice(0, MAX_COLUMNS)) {
      const fk = t.foreignKeys.find((f) => f.column === c.name);
      out.push(
        [
          `  ${c.name} ${c.sqlType || 'ANY'}`,
          t.primaryKey?.length === 1 && t.primaryKey[0] === c.name ? 'PRIMARY KEY' : '',
          c.notNull ? 'NOT NULL' : '',
          c.unique && t.primaryKey?.[0] !== c.name ? 'UNIQUE' : '',
          c.default === null ? '' : `DEFAULT ${c.default}`,
          fk ? `-> ${fk.table}.${fk.toColumn} ON DELETE ${fk.onDelete}` : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
    }
    if (t.columns.length > MAX_COLUMNS)
      out.push(`  … ${String(t.columns.length - MAX_COLUMNS)} more columns`);
    if ((t.primaryKey?.length ?? 0) > 1) out.push(`  primary key (${(t.primaryKey ?? []).join(', ')})`);
    for (const i of t.indexes)
      out.push(
        `  index ${i.name}${i.unique ? ' UNIQUE' : ''} (${
          i.columns.length && i.columns.every(Boolean)
            ? i.columns.join(', ')
            : (indexKeysOf(indexSql[i.name] ?? '') ?? 'expression')
        })`,
      );
    for (const check of t.checks) out.push(`  check (${check})`);
  }
  if (tables.length > MAX_TABLES)
    out.push('', `… ${String(tables.length - MAX_TABLES)} more tables (--table <name> shows one)`);
  if (only && !tables.length) out.push(`no table named ${only}`);
  // Drizzle applies the journal in order: applied = every entry up to the ledger's last `created_at`
  const last = schema.ledger.lastCreatedAt ?? -1;
  const applied = journal.filter((e) => e.when <= last).map((e) => e.tag);
  const pending = journal.filter((e) => e.when > last).map((e) => e.tag);
  out.push(
    '',
    `migrations applied: ${String(schema.ledger.count)}${applied.length ? ` (${applied.join(', ')})` : ''}`,
    `migrations pending here: ${pending.length ? pending.join(', ') : 'none'}`,
  );
  if (schema.ledger.count !== applied.length)
    out.push(
      `warning: the ledger holds ${String(schema.ledger.count)} rows, drizzle/ matches ${String(applied.length)}`,
    );
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const value = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? undefined : args[i + 1];
  };
  const env = value('env');
  try {
    if (env !== undefined && env !== 'dev' && env !== 'live') throw new Error('--env must be dev or live');
    const key = process.env['TOTALUM_PROJECT_KEY'];
    if (!key) throw new Error('TOTALUM_PROJECT_KEY is not set');
    const api = process.env['TOTALUM_SDK_API_URL'] || 'https://sdk-api.totalum.app';
    const res = await fetch(`${api}/v1/db/schema${env ? `?env=${env}` : ''}`, {
      headers: { authorization: `Bearer ${key}` },
    });
    const body: { data?: Schema; errors?: { errorCode: string; errorMessage: string } } = await res.json();
    if (!res.ok || !body.data)
      throw new Error(
        `${String(res.status)} ${body.errors?.errorCode ?? ''}: ${body.errors?.errorMessage ?? ''}`,
      );
    const journal = (JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: Journal })
      .entries;
    const names = expressionIndexes(body.data).map((i) => i.name);
    const indexSql: Record<string, string> = {};
    if (names.length) {
      const { results } = await totalumD1({ env })
        .prepare(
          `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name IN (${names.map(() => '?').join(', ')})`,
        )
        .bind(...names)
        .all<{ name: string; sql: string | null }>();
      for (const r of results) if (r.sql) indexSql[r.name] = r.sql;
    }
    console.log(formatSchema(body.data, journal, value('table'), indexSql).join('\n'));
  } catch (err) {
    console.error(`db:schema failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
