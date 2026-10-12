// `npm run try:form -- <path> [name=value]… [--form N] [--as email:password]` (research 69): submits a form of a
// page on the running `npm run dev` exactly as a browser without JavaScript does — the page's hidden `$ACTION_*`
// fields, its checked/selected/prefilled defaults and the given values (repeat `name=` for several), multipart, same
// origin — so a server action runs for real on the local database. `--json METHOD /path ['{…}']` calls a route
// handler with a JSON body instead (research 70). `/<page> --action <name> '[args]'` calls a server action the page's
// client code calls with arguments (no form to submit), as that code does. Prints the status, the redirect, the text the answer shows that the
// page did not (or the start of the JSON answer), and the errors the dev server logged meanwhile; exits 1 on a 5xx, a
// logged error, or a run longer than TRY_FORM_TIMEOUT_MS (30 s; then the dev log's last lines). `--as` signs up
// (or in) first and sends that session. Platform-owned.
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { checkWorkerSafe } from './check-worker-safe.mjs';

const ORIGIN = process.env.TRY_FORM_ORIGIN ?? `http://localhost:${process.env.PORT ?? '3100'}`; // `npm run dev`'s port
const LOG = process.env.TRY_FORM_LOG ?? '/tmp/dev.log';
const SESSIONS = process.env.TRY_FORM_SESSIONS ?? '/tmp/try-form-sessions.json';
const TIMEOUT_MS = Number(process.env.TRY_FORM_TIMEOUT_MS ?? 30_000);
const USAGE = `usage: npm run try:form -- /<page> [name=value]… [--form N] [--as email:password]
   or: npm run try:form -- --json POST /api/<route> '{"a":1}' [--as email:password]
   or: npm run try:form -- /<page> --action <exported name> '["arg", 2]' [--as email:password]`;
// where `next dev` lists the server actions of the pages it has compiled
const ACTIONS = process.env.TRY_FORM_ACTIONS ?? '.next/dev/server/server-reference-manifest.json';

class TimedOut extends Error {}
// one deadline for the whole run, so a try never outlives the agent's Bash call (research 70 §5: stalled dev servers)
const deadline = AbortSignal.timeout(TIMEOUT_MS);

/** `fetch` and its body, within the run's deadline. */
async function request(label, url, init = {}) {
  try {
    const res = await fetch(url, { ...init, signal: deadline });
    return { res, text: await res.text() };
  } catch (e) {
    if (e?.name !== 'TimeoutError') throw e;
    throw new TimedOut(`${label} timed out after ${String(TIMEOUT_MS / 1000)} s`);
  }
}

const clip = (l, n = 160) => (l.length > n ? `${l.slice(0, n)}…` : l);
const decode = (s) =>
  s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|#39|apos));/gi, (_, d, h, n) =>
    d
      ? String.fromCodePoint(Number(d))
      : h
        ? String.fromCodePoint(parseInt(h, 16))
        : { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" }[n.toLowerCase()],
  );
const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? decode(m[1] ?? m[2]) : undefined;
};
/** A boolean attribute (`checked`, `selected`, …), never matched inside another attribute's quoted value. */
const flagged = (tag, name) =>
  new RegExp(`\\s${name}(?=[\\s=/>]|$)`, 'i').test(tag.replace(/"[^"]*"|'[^']*'/g, '""'));

/** The values a browser sends for a field nobody touched: hidden, checked, selected or prefilled. */
function defaultsOf(tag, type, inner) {
  if (flagged(tag, 'disabled')) return [];
  if (type === 'select') {
    const options = [...inner.matchAll(/<option\b([^>]*)>([^<]*)/gi)].map(([, a, text]) => ({
      value: attr(` ${a}`, 'value') ?? decode(text.trim()),
      selected: flagged(` ${a}`, 'selected'),
    }));
    const picked = options.filter((o) => o.selected).map((o) => o.value);
    return picked.length || flagged(tag, 'multiple') || !options[0] ? picked : [options[0].value];
  }
  if (type === 'checkbox' || type === 'radio')
    return flagged(tag, 'checked') ? [attr(tag, 'value') ?? 'on'] : [];
  if (['submit', 'button', 'reset', 'image', 'file'].includes(type)) return [];
  const value = type === 'textarea' ? decode(inner) : (attr(tag, 'value') ?? '');
  return type === 'hidden' || value ? [value] : [];
}

/** Every `<form>` of the page: its action and fields, each with the values a browser would send untouched. */
export function formsOf(html) {
  return [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)].map(([form]) => {
    const fields = [...form.matchAll(/<(select|textarea)\b[^>]*>([\s\S]*?)<\/\1>|<input\b[^>]*>/gi)].map(
      ([tag, block, inner = '']) => {
        const open = tag.slice(0, tag.indexOf('>') + 1);
        const type = block ? block.toLowerCase() : (attr(open, 'type') ?? 'text').toLowerCase();
        return { name: attr(open, 'name'), type, defaults: defaultsOf(open, type, inner) };
      },
    );
    return { action: attr(form.slice(0, form.indexOf('>')), 'action'), fields: fields.filter((f) => f.name) };
  });
}

/** The page's visible text, one line per text run (scripts, styles and tags removed). */
export function textOf(html) {
  return html
    .replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, '\n')
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map((l) => decode(l).trim())
    .filter(Boolean);
}

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * The session cookie for `email:password`, kept in `TRY_FORM_SESSIONS` between calls: better-auth rate-limits sign-in
 * (a few a 10 s), so signing in on every call answered 429 (research 69, P2). Reused while get-session accepts it.
 */
async function session(spec) {
  const at = spec.lastIndexOf(':');
  const [email, password] = [spec.slice(0, at), spec.slice(at + 1)];
  const saved = parse(size(SESSIONS) ? readFileSync(SESSIONS, 'utf8') : '') ?? {};
  const key = `${ORIGIN} ${email}`;
  if (saved[key]) {
    const me = await request('GET /api/auth/get-session', `${ORIGIN}/api/auth/get-session`, {
      headers: { cookie: saved[key] },
    });
    if (me.res.ok && parse(me.text)?.user) return saved[key];
  }
  for (const path of ['/api/auth/sign-in/email', '/api/auth/sign-up/email']) {
    let res;
    for (let i = 0; i < 2; i++) {
      ({ res } = await request(`POST ${path}`, ORIGIN + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ email, password, name: email.split('@')[0] }),
      }));
      if (res.status !== 429) break;
      const wait = Math.min(Number(res.headers.get('x-retry-after') ?? 10), 15);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
    if (res.ok) {
      saved[key] = res.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; ');
      writeFileSync(SESSIONS, JSON.stringify(saved));
      return saved[key];
    }
  }
  throw new Error(`--as: could not sign in or sign up ${email}`);
}

async function main(argv) {
  // a flag and its value given as one argument (`A="--as a@b.c:pw"; … $A` in zsh, which does not split it) is the flag
  const args = argv.flatMap((a) => {
    const m = /^(--(?:as|form))\s+(\S.*)$/.exec(a);
    return m ? [m[1], m[2]] : [a];
  });
  const flag = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args.splice(i, 2)[1];
  };
  const as = flag('--as');
  const index = flag('--form');
  const a = args.indexOf('--action');
  const action = a === -1 ? undefined : args.splice(a, 3).slice(1); // [name, args?]
  const j = args.indexOf('--json');
  const json = j === -1 ? undefined : args.splice(j, 4).slice(1); // [method, path, body?]
  const [path, ...pairs] = json ? [json[1]] : args;
  if (!path?.startsWith('/') || (json && !json[0]) || (action && !action[0])) throw new Error(USAGE);
  const logFrom = size(LOG);
  try {
    const cookie = as ? await session(as) : '';
    const headers = { origin: ORIGIN, ...(cookie && { cookie }) };
    if (action) return await tryAction(path, action[0], action[1] ?? '[]', headers);
    return json
      ? await tryJson(json[0].toUpperCase(), path, json[2], headers)
      : await tryPage(path, index, pairs, headers);
  } catch (e) {
    if (!(e instanceof TimedOut)) throw e;
    const fresh = logLines(LOG, logFrom).filter(Boolean);
    const tail = (fresh.length ? fresh : logLines(LOG, 0).filter(Boolean)).slice(-8).map((l) => clip(l, 200));
    console.log(`${e.message}; dev log, last lines:\n${tail.join('\n')}`);
    return 1;
  }
}

/** A route handler called with a JSON body (research 70 §6: writes through `fetch` had no try). */
async function tryJson(method, path, body, headers) {
  const logFrom = size(LOG);
  const { res, text } = await request(`${method} ${path}`, ORIGIN + path, {
    method,
    headers: { ...headers, ...(body !== undefined && { 'content-type': 'application/json' }) },
    body,
    redirect: 'manual',
  });
  const location = res.headers.get('location');
  console.log(`${method} ${path} → ${String(res.status)}${location ? ` → ${location}` : ''}`);
  if (text.trim()) console.log(clip(text.replace(/\s+/g, ' ').trim(), 300));
  const errors = await errorsSince(logFrom);
  if (errors.length) console.log(`dev log:\n${errors.join('\n')}`);
  return res.status >= 500 || errors.length ? 1 : 0;
}

/**
 * A server action the page's client code calls with arguments (runcost, 2026-10-02: with no form to submit, every
 * build spent 4–8 agent turns writing its own caller from Next's manifest). The page is rendered first, so `next dev`
 * has compiled its actions; then the call a browser makes: `Next-Action: <id>`, the arguments as a JSON array.
 */
async function tryAction(path, name, args, headers) {
  if (!Array.isArray(parse(args))) throw new Error(`--action: the arguments must be a JSON array\n${USAGE}`);
  const page = await request(`GET ${path}`, ORIGIN + path, { headers, redirect: 'manual' });
  if (page.res.status >= 300 && page.res.status < 400) {
    console.log(
      `GET ${path} → ${String(page.res.status)} → ${String(page.res.headers.get('location'))}: not signed in? use --as email:password`,
    );
    return 1;
  }
  const known = Object.entries(parse(size(ACTIONS) ? readFileSync(ACTIONS, 'utf8') : '')?.node ?? {});
  const id = known.find(([, v]) => v.exportedName === name)?.[0];
  if (!id) {
    const names = [...new Set(known.map(([, v]) => v.exportedName))].join(', ');
    console.log(`no server action "${name}" in the pages rendered so far; found: ${names || 'none'}`);
    return 1;
  }
  const logFrom = size(LOG);
  const { res, text } = await request(`POST ${path}`, ORIGIN + path, {
    method: 'POST',
    headers: { ...headers, 'next-action': id, 'content-type': 'text/plain;charset=UTF-8' },
    body: args,
    redirect: 'manual',
  });
  // the action's return value is row 1 of the answer (row 0 points at it; `1:D…` is `next dev`'s debug row)
  const returned = text.split('\n').find((l) => /^1:(?!D)/.test(l));
  const location = res.headers.get('x-action-redirect') ?? res.headers.get('location');
  console.log(
    `${name}(${clip(args.slice(1, -1), 120)}) → ${String(res.status)}${location ? ` → ${location}` : ''}`,
  );
  if (returned) console.log(`returns: ${clip(returned.slice(2), 400)}`);
  const errors = await errorsSince(logFrom);
  if (errors.length) console.log(`dev log:\n${errors.join('\n')}`);
  return res.status >= 500 || errors.length ? 1 : 0;
}

async function tryPage(path, index, pairs, headers) {
  // this post would never finish and would take the dev server's memory with it (research 59 §9): refuse it
  const hang = checkWorkerSafe().filter((f) => f.rule === 'bound-action-state');
  for (const f of hang)
    console.log(
      `${f.code} ${f.file}:${String(f.line)} ${f.found}: ${f.reason}\nUse instead: ${f.replacement}`,
    );
  if (hang.length) return 1;
  const values = pairs.map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]);
  let run = await submit(path, index, values, headers);
  // `next dev` registers a page's server actions a moment after it first renders them: a POST right after that first
  // GET can answer 500 "Failed to find Server Action" (research 69, P3's admin forms); one retry after a pause
  if (run?.errors.some((l) => l.includes('Failed to find Server Action'))) {
    await new Promise((r) => setTimeout(r, 1500));
    run = await submit(path, index, values, headers);
  }
  if (!run) return 1;
  const { res, target, pick, missing, shown, errors } = run;
  console.log(
    `POST ${target} (form ${String(pick)}) → ${String(res.status)}${res.headers.get('location') ? ` → ${res.headers.get('location')}` : ''}`,
  );
  if (missing.length) console.log(`not sent: ${missing.join(', ')}`);
  if (shown.length) console.log(`shows: ${shown.join(' | ')}`);
  if (errors.length) console.log(`dev log:\n${errors.join('\n')}`);
  return res.status >= 500 || errors.length ? 1 : 0;
}

/** GET the page, POST the chosen form; `undefined` (and a printed reason) when the page has no such form. */
async function submit(path, index, values, headers) {
  const { res: page, text: html } = await request(`GET ${path}`, ORIGIN + path, {
    headers,
    redirect: 'manual',
  });
  if (page.status >= 300 && page.status < 400) {
    // never parse the page it redirects to (a login page's forms are not this page's)
    console.log(
      `GET ${path} → ${String(page.status)} → ${String(page.headers.get('location'))}: not signed in? use --as email:password`,
    );
    return undefined;
  }
  const forms = formsOf(html);
  const pick =
    index === undefined
      ? forms.findIndex((f) => f.fields.some((x) => x.name.startsWith('$ACTION_')))
      : Number(index);
  const form = forms[pick];
  if (!form) {
    console.log(
      `GET ${path} → ${String(page.status)}: ${String(forms.length)} form(s), none with a server action; pass --form N, sign up or in with --as email:password, call an action its client code calls with --action <name> '[args]', or try its API route with --json`,
    );
    return undefined;
  }
  const given = new Set(values.map(([k]) => k));
  const body = new FormData();
  for (const f of form.fields) if (!given.has(f.name)) for (const v of f.defaults) body.append(f.name, v);
  for (const [k, v] of values) body.append(k, v);
  const skip = ['submit', 'button', 'reset', 'image'];
  const missing = [
    ...new Set(form.fields.filter((f) => !body.has(f.name) && !skip.includes(f.type)).map((f) => f.name)),
  ];
  const logFrom = size(LOG);
  const target = form.action && !form.action.startsWith('javascript:') ? form.action : path;
  const { res, text } = await request(`POST ${target}`, new URL(target, ORIGIN + path), {
    method: 'POST',
    headers,
    body,
    redirect: 'manual',
  });
  const before = new Set(textOf(html));
  const shown = textOf(text)
    .filter((l) => !before.has(l))
    .slice(0, 8)
    .map((l) => clip(l));
  return { res, target, pick, missing, shown, errors: await errorsSince(logFrom) };
}

/** The error lines the dev server logged since `from` (it writes its log just after answering). */
async function errorsSince(from) {
  await new Promise((r) => setTimeout(r, 300));
  return logLines(LOG, from)
    .filter((l) => /error|⨯|failed|exception/i.test(l) && !/^\s*\d+ \|/.test(l))
    .slice(0, 10)
    .map((l) => clip(l, 200));
}

const size = (file) => {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
};
const logLines = (file, from) => {
  try {
    return readFileSync(file).subarray(from).toString('utf8').split('\n');
  } catch {
    return [];
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
