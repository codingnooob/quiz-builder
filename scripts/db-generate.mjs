// `npm run db:generate [-- --name x]`: drizzle-kit generate, then one fix (research 72 p0mig). When drizzle-kit rebuilds a table (a DEFAULT,
// CHECK or type change), it re-creates the table's indexes from its snapshot and quotes an expression index's
// expression as if it were a column name — `ON \`users\` (\`lower("email")\`)` — so the migration fails with "no such
// column" on D1 and Turso. A column name never holds a parenthesis, so a quoted item that does is unquoted again.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const kit = spawnSync('drizzle-kit', ['generate', ...process.argv.slice(2)], { stdio: 'inherit' });
if (kit.status !== 0) process.exit(kit.status ?? 1);

const folder = join(process.cwd(), 'drizzle');
const INDEX = /(CREATE (?:UNIQUE )?INDEX [^\n]*? ON `[^`]+` \()([^\n]*)(\);?)/g;

for (const file of readdirSync(folder).filter((f) => f.endsWith('.sql'))) {
  const path = join(folder, file);
  const sql = readFileSync(path, 'utf8');
  const fixed = sql.replace(
    INDEX,
    (_, head, list, tail) => head + list.replace(/`([^`]*\([^`]*)`/g, '$1') + tail,
  );
  if (fixed !== sql) {
    writeFileSync(path, fixed);
    console.log(`db:generate: ${file}: expression index unquoted (drizzle-kit table rebuild)`);
  }
}
