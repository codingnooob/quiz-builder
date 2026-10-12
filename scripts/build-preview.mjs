// `npm run build:preview` (plan 06 §5, plan 07 §4.2): `check-worker-safe` → `next build` (standalone, no type-check) → then in parallel
// `tsc --noEmit` and the OpenNext bundle → `wrangler --dry-run --minify` → hash manifest. The preview fails if either
// branch fails and prints both failures. The type-check starts only after `next build`, because `next build` first
// deletes and rewrites `.next/types` (the route types tsc reads); the OpenNext bundle phase never touches them.
// Minified: a 4.2 MB Worker instead of 6.9 MB, so the preview deploy's PUT is faster (S3, research 43).
// Output layout (read by PGM's preview deploy; documented in AGENTS.md):
//   .open-next/assets/**              static assets, uploaded as-is
//   .open-next/preview/worker.js      the Worker, one ES module (main_module); worker.js.map beside it
//   .open-next/preview/manifest.json  { worker: { mainModule, modules, compatibilityDate, compatibilityFlags },
//                                       assets: { "/<path>": { hash, size, contentType } } }
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { encodeOpenNextQuery } from './opennext-query.mjs';

// `--check` (`npm run check`, the agent's verification; research 59 §8): what can fail on the app's code — the
// Worker-safety scan, `next build` and `tsc` — without the OpenNext bundle, wrangler and the manifest. `--bundle` (AM,
// after a check of the same tree passed): only those, on the check's `.next`. No flag: everything.
const mode = process.argv[2] ?? '';
const OUT = '.open-next/preview';
const ASSETS = '.open-next/assets';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

// The local binaries directly: `npx` costs ≈ 0.35 s per call on a Sprite and only finds these same files (research 59).
const BIN = 'node_modules/.bin/';
const bin = (name) => BIN + name;
// Quiet on success (research 39 §7.2: every line an agent's command prints stays in its context for the rest of the
// run): a failing step prints only the tail of its output, where the error is.
const run = (cmd, args, env = {}) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', ...env },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) =>
      // a failure names the step as the agent would type it (`npx tsc --noEmit`)
      resolve({ ok: code === 0, step: [cmd.replace(BIN, 'npx '), ...args].join(' '), out }),
    );
  });
// the error lines only: no colours, banners or Node stack frames, nothing after the wrapper's own crash
const failure = ({ step, out }) => {
  const lines = stripVTControlCharacters(out)
    .split('\n')
    .filter((l) => l.trim() && !/^\s+at |^[│┌└]/.test(l));
  const end = lines.findIndex((l) => l.startsWith('node:internal'));
  return `${mode === '--check' ? 'check' : 'build:preview'} failed in \`${step}\`:\n${(end === -1 ? lines : lines.slice(0, end)).slice(-40).join('\n')}`;
};
const files = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => join(d.parentPath, d.name));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const fail = (results) => {
  console.error(results.map(failure).join('\n\n'));
  process.exit(1);
};
const ok = { ok: true };
let next = ok;
if (mode !== '--bundle') {
  // Node-only code fails on Workers only after the deploy: refuse it before building (A7.14, plan 06 §5.4); a migration
  // file a database already applied stays as it was (sefix SE3: the next import and publish fail on an edited one)
  const before = await Promise.all([
    run('node', ['scripts/check-worker-safe.mjs']),
    run(bin('tsx'), ['scripts/migrate.ts', '--check-applied']),
    run('node', ['scripts/check-deps.mjs']), // B2-PJ4: a tree `npm ci` refuses fails every later build
  ]);
  if (before.some((r) => !r.ok)) fail(before.filter((r) => !r.ok));
  if (before[0].out.trim()) console.error(stripVTControlCharacters(before[0].out).trim()); // its warnings (b4fix B4-6)
  rmSync('.open-next', { recursive: true, force: true }); // never a manifest of an older build beside this one
  // What `opennextjs-cloudflare build` sets before it runs `npm run build` itself (single app: trace root = here).
  next = await run('npm', ['run', 'build'], {
    NEXT_PRIVATE_STANDALONE: 'true',
    NEXT_PRIVATE_OUTPUT_TRACE_ROOT: process.cwd(),
  });
}
// Turbopack writes a byte-identical server chunk once per route handler that imports it (better-auth with the app's db
// code, ≈ 0.5 MB each), and OpenNext bundles every copy into the Worker (research 58 §3.3: the Worker's size is part of
// every cold start). Each later copy becomes a one-line re-export of the first: same modules, one copy in the bundle.
const dedupeChunks = (dir) => {
  const first = new Map();
  const chunks = files(dir).filter((f) => f.endsWith('.js'));
  for (const file of chunks.sort()) {
    const code = readFileSync(file, 'utf8').replace(/\n\/\/# sourceMappingURL=\S+\s*$/, '');
    const key = sha256(code);
    const same = first.get(key);
    if (!same) {
      first.set(key, file);
      continue;
    }
    const target = relative(dirname(file), same).split(sep).join('/');
    writeFileSync(
      file,
      `module.exports = require(${JSON.stringify(target.startsWith('.') ? target : `./${target}`)});\n`,
    );
    rmSync(`${file}.map`, { force: true });
  }
};
const bundle = async () => {
  dedupeChunks('.next/standalone/.next/server/chunks'); // what OpenNext bundles
  encodeOpenNextQuery(); // `?q=C%2B%2B` must reach the app as `C++` (research 72b)
  const opennext = await run(bin('opennextjs-cloudflare'), ['build', '--skipNextBuild']);
  return opennext.ok ? run(bin('wrangler'), ['deploy', '--dry-run', '--minify', '--outdir', OUT]) : opennext;
};
const failed = (
  await Promise.all([
    mode === '--check' || !next.ok ? next : bundle(),
    mode === '--bundle' ? ok : run(bin('tsc'), ['--noEmit']),
  ])
).filter((r) => !r.ok);
if (failed.length) fail(failed);
if (mode === '--check') {
  console.log('check: passed');
  process.exit(0);
}
rmSync(join(OUT, 'README.md'), { force: true });

const modules = files(OUT)
  .filter((f) => !f.endsWith('.map'))
  .map((f) => {
    const buf = readFileSync(f);
    return { name: relative(OUT, f), sha256: sha256(buf), size: buf.length };
  });
const assets = Object.fromEntries(
  files(ASSETS).map((f) => {
    const buf = readFileSync(f);
    const path = '/' + relative(ASSETS, f).split(sep).join('/');
    const contentType = TYPES[extname(f).toLowerCase()] ?? 'application/octet-stream';
    return [path, { hash: sha256(buf).slice(0, 32), size: buf.length, contentType }];
  }),
);
const wrangler = JSON.parse(
  readFileSync('wrangler.jsonc', 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1'),
);
const manifest = {
  worker: {
    mainModule: 'worker.js',
    modules,
    compatibilityDate: wrangler.compatibility_date,
    compatibilityFlags: wrangler.compatibility_flags,
    // Carried only so PGM's uploader refuses them with a pointer at totalum.realtime (A6.33); never uploaded.
    ...(wrangler.durable_objects && { durableObjects: wrangler.durable_objects }),
    ...(wrangler.migrations && { migrations: wrangler.migrations }),
  },
  assets,
};
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(
  `build:preview: ${String(modules.length)} module(s), ${String(Object.keys(assets).length)} assets`,
);
