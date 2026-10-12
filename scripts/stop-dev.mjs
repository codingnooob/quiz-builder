// Stops this project's `npm run dev` (research 70): `npm run check` runs it first — `next build` beside a live dev server
// went over the Sprite's 6 GiB memory limit (a killed run, a lost Sprite) and the agent's own `pkill` is not allowed —
// and `npm run dev` runs it first (`predev`), so a restart never meets the old server on its port. Linux only (`/proc`):
// the processes of this user whose working directory is this project and whose command line is Next's dev server.
import { readdirSync, readFileSync, readlinkSync } from 'node:fs';

const root = process.cwd();
const uid = process.getuid?.();
const parentOf = (pid) => {
  try {
    return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').at(-1)?.split(' ')[1];
  } catch {
    return undefined;
  }
};
// never this process or the ones that started it (`npm run dev` → `sh` → here)
const mine = new Set();
for (let p = String(process.pid); p && p !== '0' && !mine.has(p); p = parentOf(p)) mine.add(p);

function devServers() {
  let entries;
  try {
    entries = readdirSync('/proc');
  } catch {
    return []; // not Linux: nothing to stop
  }
  return entries.filter((pid) => {
    if (!/^\d+$/.test(pid) || mine.has(pid)) return false;
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ');
      const owner = /^Uid:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1];
      return (
        Number(owner) === uid &&
        readlinkSync(`/proc/${pid}/cwd`) === root &&
        (/\bnext(\.js)?\s+dev\b/.test(cmd) || /^next-server\b/.test(cmd))
      );
    } catch {
      return false; // gone, or not ours
    }
  });
}

const stop = (signal) => {
  for (const pid of devServers()) {
    try {
      process.kill(Number(pid), signal);
    } catch {
      // already gone
    }
  }
};

stop('SIGTERM');
for (let i = 0; i < 20 && devServers().length > 0; i++) await new Promise((r) => setTimeout(r, 250));
stop('SIGKILL');
