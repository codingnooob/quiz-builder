import { pathToFileURL } from 'node:url';

import { totalumLogs } from 'totalum-sdk/logs';
import type { LogsPage, LogsQuery } from 'totalum-sdk/logs';

// `npm run logs -- [--env dev|live] [--level error] [--q text] [--status 5xx] [--path /api/x] [--request-id id]
// [--since 15m] [--limit N] [--follow [--timeout 20]]` (plan 06 §5, A5.25): the app's Worker logs, one line each,
// oldest first. `--follow` keeps printing new lines (1 s polls) until `--timeout` seconds (max 30). Free. Platform-owned.

type Item = LogsPage['items'][number];

export const formatLine = (i: Item) =>
  [i.ts, i.level.toUpperCase(), i.method, i.path, i.status, i.message].filter((x) => x != null).join(' ') +
  (i.exception ? ` | ${i.exception.name}: ${i.exception.message}` : '') +
  ` [${i.requestId ?? '-'}]`;

const UNIT = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

export function parseArgs(argv: string[], now = Date.now()) {
  const value = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const since = /^(\d+)([smhd])$/.exec(value('since') ?? '');
  const query: LogsQuery = {
    env: value('env') as LogsQuery['env'],
    level: value('level') as LogsQuery['level'],
    q: value('q'),
    status: value('status'),
    path: value('path'),
    requestId: value('request-id'),
    limit: value('limit') === undefined ? undefined : Number(value('limit')),
    from: since
      ? new Date(now - Number(since[1]) * UNIT[since[2] as keyof typeof UNIT]).toISOString()
      : undefined,
  };
  const timeout = Math.min(Math.max(Number(value('timeout') ?? 20), 1), 30);
  return { query, follow: argv.includes('--follow'), timeoutMs: timeout * 1000 };
}

/** One query, or (follow) a query per second until `timeoutMs`, printing each line once, oldest first. */
export async function printLogs(
  query: LogsQuery,
  options: { follow: boolean; timeoutMs: number },
  // the agent's own read (the sandbox key: free, the run's logs), not the app key `totalum-sdk` prefers in the sandbox
  run: (q: LogsQuery) => Promise<LogsPage> = (q) =>
    totalumLogs({ key: process.env['TOTALUM_PROJECT_KEY'] }).query(q),
  print: (line: string) => void = console.log,
) {
  const seen = new Set<string>();
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    const page = await run(query);
    for (const item of [...page.items].reverse()) {
      const line = formatLine(item);
      if (!seen.has(line)) print(line);
      seen.add(line);
    }
    if (!options.follow || Date.now() + 1000 > deadline) return seen.size;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { query, ...options } = parseArgs(process.argv.slice(2));
  try {
    if ((await printLogs(query, options)) === 0) console.log('(no log lines)');
  } catch (err) {
    console.error(`logs failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
