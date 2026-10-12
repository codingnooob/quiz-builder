// `npm run check-worker-safe [--json]` (A7.14, plan 06 §5.4): refuses app code that runs under `npm run dev` (Node) but
// would fail on Cloudflare Workers, where the preview and the published site run. `npm run build:preview` runs it
// first. Scans src/ except tests; scripts/, drizzle/ and the mobile folders are Node or not Worker code. Platform-owned.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { scan } from './worker-safe-rules.mjs';

const MAX = 50;
const TEST = /(^|\/)(__tests__|__mocks__)\/|\.(test|spec)\.[cm]?[jt]sx?$/;

export function checkWorkerSafe(root = '.', node = process.versions.node) {
  const files = readdirSync(join(root, 'src'), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && /\.[cm]?[jt]sx?$/.test(d.name))
    .map((d) => relative(root, join(d.parentPath, d.name)))
    .filter((f) => !TEST.test(f))
    .sort();
  return [
    ...files.flatMap((file) =>
      scan(readFileSync(join(root, file), 'utf8')).map(({ rule, found, line, col }) => ({
        file,
        line,
        col,
        rule: rule.id,
        code: rule.code ?? 'NODE_ONLY_API_IN_APP_CODE',
        found,
        reason: rule.reason,
        replacement: rule.use,
      })),
    ),
    ...authLinks(root, files),
    ...fontTokens(root),
    ...adminByEmail(root, files),
    ...outerColumnInSubquery(root, files),
    ...cachedReadUserData(root, files),
    ...staffOnlyPublicData(root),
    ...ownerCantSeeSubmissions(root, files),
    ...otherNode(root, node),
  ];
}

// bench5 P3: in a single-table `db.select({ n: sql`(select … where lessons.course_id = ${courses.id})` })` Drizzle
// prints the outer column bare (`"id"`), so it binds to the subquery's own table and every card counts 0. A select
// field (`name: sql…`) holding a subquery may name `${t.col}` only for a table it reads as `${t}`; anything else is
// written `${eq(inner.col, outer.col)}` or `db.$count(…)` (database.md §3), which print qualified. A select with a join
// (up to the next `.select(` or `;`) prints every column qualified, so it is left alone.
const JOIN = /\.(?:inner|left|right|full|cross)Join\s*\(/;
const SUBQUERY_FIELD = /\b[\w$]+\s*:\s*sql\s*(?:<[^>`]*>)?\s*`([^`]*)`/g;
const COLUMN = /\$\{\s*([A-Za-z_$][\w$]*)\.[A-Za-z_$][\w$]*\s*\}/g;
function outerColumnInSubquery(root, files) {
  return files.flatMap((file) => {
    const text = readFileSync(join(root, file), 'utf8');
    return [...text.matchAll(SUBQUERY_FIELD)].flatMap((field) => {
      const body = field[1] ?? '';
      const tail = text.slice(field.index + field[0].length);
      const stop = tail.search(/\.select\s*\(|;/);
      if (!/\(\s*select\b/i.test(body) || JOIN.test(stop < 0 ? tail : tail.slice(0, stop))) return [];
      const start = field.index + field[0].indexOf('`') + 1;
      return [...body.matchAll(COLUMN)]
        .filter((c) => !new RegExp(String.raw`\$\{\s*${c[1]?.replaceAll('$', '\\$')}\s*\}`).test(body))
        .map((c) => {
          const before = text.slice(0, start + c.index).split('\n');
          return {
            file,
            line: before.length,
            col: (before.at(-1)?.length ?? 0) + 1,
            rule: 'outer-column-in-subquery',
            code: 'OUTER_COLUMN_IN_SUBQUERY',
            found: c[0],
            reason:
              "In a subquery inside select({...}), Drizzle prints this column without its table, so SQLite reads it as the subquery's own table's column: the result is always 0 or empty.",
            replacement:
              'db.$count(lessons, eq(lessons.courseId, courses.id)) for a count; for anything else put the comparison in eq() and the table as ${…}: sql<number>`(select avg(${reviews.rating}) from ${reviews} where ${eq(reviews.courseId, courses.id)})`; or a leftJoin + groupBy (_system-docs/database.md §3).',
          };
        });
    });
  });
}

// sjfix SJ2: anyone can sign up with the owner's address (sign-up does not verify it), so a role granted by comparing
// the user's e-mail with an address makes the first one to register it the admin. One line that compares `.email`
// and names an admin/staff role, without `emailVerified`, is refused; `isAdmin(user)` (src/lib/admin.ts) is the way.
const EMAIL_CMP = /\.email\b[^;\n]*?[!=]==?|[!=]==?[^;\n]*?\.email\b|\.(?:includes|has)\(\s*[\w?.]*\.email\b/;
const ADMINISH = /admin|staff|superuser|moderator|\brole\b/i;
function adminByEmail(root, files) {
  return files
    .filter((f) => f !== 'src/lib/admin.ts')
    .flatMap((file) =>
      readFileSync(join(root, file), 'utf8')
        .split('\n')
        .flatMap((text, i) => {
          const m = EMAIL_CMP.exec(text);
          if (!m || !ADMINISH.test(text) || /emailVerified/.test(text)) return [];
          return [
            {
              file,
              line: i + 1,
              col: m.index + 1,
              rule: 'admin-by-unverified-email',
              code: 'ADMIN_BY_UNVERIFIED_EMAIL',
              found: text.trim().slice(0, 120),
              reason:
                'An admin or staff role granted by the e-mail string: anyone who signs up first with that address gets it, because sign-up does not verify e-mails.',
              replacement:
                "`isAdmin(user)` from '@/lib/admin': the owner's Totalum e-mail and the addresses in `site.admins` (src/lib/site.ts), each only once verified; the owner verifies from /account.",
            },
          ];
        }),
    );
}

// cachedrel (A10.37, research 75 §15.8): `cachedRead` shares a read between every visitor for a few seconds. In a file
// that reads the session, the user or the cookies, or that writes (a server action, a route's POST/PUT/PATCH/DELETE),
// a visitor could get another's data or miss their own write. One finding per file, at its first `cachedRead(`.
const USER_OR_WRITE = [
  /['"]use server['"]/,
  /export\s+(?:async\s+)?(?:function|const)\s+(?:POST|PUT|PATCH|DELETE)\b/,
  /\b(?:withTotalumSession|currentSession|getSession|getUser|getAuth|loadPage|cookies|headers|isAdmin|useSession)\(/,
  /\bauth\.api\b/,
];
function cachedReadUserData(root, files) {
  return files
    .filter((f) => f !== 'src/lib/cached-read.ts')
    .flatMap((file) => {
      const text = readFileSync(join(root, file), 'utf8');
      const call = /\bcachedRead\s*[(<]/.exec(text);
      const found = call && USER_OR_WRITE.map((re) => re.exec(text)?.[0]).find(Boolean);
      if (!found) return [];
      return [
        {
          file,
          line: text.slice(0, call.index).split('\n').length,
          col: call.index - text.lastIndexOf('\n', call.index - 1),
          rule: 'cached-read-user-data',
          code: 'CACHED_READ_USER_DATA',
          found,
          reason:
            '`cachedRead` shows the same rows to every visitor for a few seconds, and this file reads who is asking or writes: a visitor could see data meant for someone else, or miss their own change.',
          replacement:
            'only public data, identical for everyone, goes through `cachedRead`, in its own module (e.g. src/lib/catalog.ts, the key naming every input: `cat:${slug}`) that the page imports; read the user with `loadPage` in the page. Dashboards, accounts, carts, admin and anything shown after a write: no `cachedRead`.',
        },
      ];
    });
}

// B2-PJ11 (c): Helio Ops ("staff only, nothing public") listed its install sites and their coordinates on the signed-out
// home. With `staffOnly: true` (src/lib/site.ts), the pages a visitor sees before signing in — and the components they
// use — may not read the database for visitors nor carry records in their code (an array of 3+ objects).
const SIGNED_OUT = [
  'src/app/page.tsx',
  'src/app/layout.tsx',
  'src/app/(accounts)/login/page.tsx',
  'src/app/(accounts)/register/page.tsx',
  'src/app/(accounts)/forgot-password/page.tsx',
  'src/app/(accounts)/verify-email/page.tsx',
  'src/app/(accounts)/auth-form.tsx',
  'src/app/(accounts)/account-forms.tsx',
  'src/components/site-header.tsx',
  'src/components/site-footer.tsx',
];
const VISITOR_READ = /from\s+['"]@\/db['"]|\bcachedRead\s*[(<]|\bloadPage\s*\(/g;
const RECORDS = /\[\s*(?:\{[^{}[\]]*\}\s*,\s*){2,}\{[^{}[\]]*\}\s*,?\s*\]/g;
function staffOnlyPublicData(root) {
  const site = join(root, 'src/lib/site.ts');
  if (!existsSync(site) || !/\bstaffOnly:\s*true\b/.test(readFileSync(site, 'utf8'))) return [];
  const read = (f) => (existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : null);
  const used = SIGNED_OUT.flatMap((f) =>
    [...(read(f) ?? '').matchAll(/from\s+['"]@\/components\/([\w/-]+)['"]/g)].map(
      (m) => `src/components/${m[1]}.tsx`,
    ),
  );
  return [...new Set([...SIGNED_OUT, ...used])].sort().flatMap((file) => {
    const text = read(file);
    if (text === null) return [];
    const reads = /signedIn:\s*true/.test(text) ? [] : [...text.matchAll(VISITOR_READ)];
    return [...reads, ...text.matchAll(RECORDS)]
      .sort((a, b) => a.index - b.index)
      .map((m) => {
        const before = text.slice(0, m.index).split('\n');
        return {
          file,
          line: before.length,
          col: (before.at(-1)?.length ?? 0) + 1,
          rule: 'staff-only-public-data',
          code: 'STAFF_ONLY_PUBLIC_DATA',
          found: m[0].replace(/\s+/g, ' ').slice(0, 120),
          reason:
            'This app is staff-only (`staffOnly: true` in src/lib/site.ts), and this page or component is shown before sign-in: anything it reads or lists is shown to anonymous visitors.',
          replacement:
            "the signed-out pages show the brand only (logo, name, one line on what the app is, the sign-in form, a photo or pattern); move the app's data behind sign-in (`loadPage(q, { signedIn: true })`, a signed-in page).",
        };
      });
  });
}

// b4fix B4-6 (r4): orders and quote requests a visitor submits were stored where only the database shows them. A table
// written with no session in the file (a public form, order or booking) must reach the owner: an e-mail sent in that
// file, or a read of the table in a file that checks `isAdmin(`. A warning (`warning: true`): `npm run check` passes.
const PUBLIC_INSERT = /\bdb\.insert\(\s*([A-Za-z_$][\w$]*)\s*\)/g;
const SIGNED_IN = /\b(?:currentSession|loadPage|getSession)\s*\(|\bauth\.api\./;
function ownerCantSeeSubmissions(root, files) {
  const text = Object.fromEntries(files.map((f) => [f, readFileSync(join(root, f), 'utf8')]));
  const staff = files.filter((f) => /\bisAdmin\s*\(/.test(text[f]));
  return files
    .filter(
      (f) => f.startsWith('src/app/') && !SIGNED_IN.test(text[f]) && !/\.email\.send\s*\(/.test(text[f]),
    )
    .flatMap((file) =>
      [...text[file].matchAll(PUBLIC_INSERT)]
        .filter((m, i, all) => all.findIndex((x) => x[1] === m[1]) === i)
        .filter((m) => !staff.some((f) => new RegExp(`\\b${m[1]}\\b`).test(text[f])))
        .map((m) => {
          const before = text[file].slice(0, m.index).split('\n');
          return {
            file,
            line: before.length,
            col: (before.at(-1)?.length ?? 0) + 1,
            rule: 'owner-cant-see-submissions',
            code: 'OWNER_CANT_SEE_SUBMISSIONS',
            warning: true,
            found: m[0],
            reason: `Visitors write \`${m[1]}\` (no session in this file), but the owner has no way to see it: no e-mail here and no staff page reading it.`,
            replacement:
              'a staff page listing them behind `isAdmin(user)` (`@/lib/admin`) and/or `totalum.email.send({ to: process.env.TOTALUM_OWNER_EMAIL, … })` here (`_system-docs/totalum-sdk/email.md`). Ignore this warning only if the owner never needs these rows (a cart, a counter).',
          };
        }),
    );
}

// B2-PJ4: `npm install x --engine-strict=false` put a package that refuses Node 22 (`engines`) in the lock: the preview
// built, then every Android build died in `npm ci` (the template's `engine-strict=true`). The project runs on Node 22
// everywhere (Sprite, preview build, Codemagic), so a locked package whose `engines.node` excludes this Node is refused.
function otherNode(root, node) {
  const lock = join(root, 'package-lock.json');
  if (!existsSync(lock)) return [];
  const packages = JSON.parse(readFileSync(lock, 'utf8')).packages ?? {};
  return Object.entries(packages)
    .filter(
      ([path, p]) => path.startsWith('node_modules/') && !p.optional && typeof p.engines?.node === 'string',
    )
    .filter(([, p]) => !satisfies(node, p.engines.node))
    .map(([path, p]) => {
      const name = path.slice(path.lastIndexOf('node_modules/') + 13);
      return {
        file: 'package-lock.json',
        line: 1,
        col: 1,
        rule: 'package-needs-other-node',
        code: 'PACKAGE_NEEDS_OTHER_NODE',
        found: `${name}@${p.version} needs node "${p.engines.node}"`,
        reason: `This project runs on Node ${node} (preview, published site and app builds), which this package refuses, so \`npm ci\` fails there. Never install with --engine-strict=false or --force.`,
        replacement: `a version of ${name} (or of the package that pulls it in) that supports Node ${node.split('.')[0]}: \`npm view ${name}@<version> engines\`, then \`npm install --save-exact ${name}@<version>\`; or another package.`,
      };
    });
}

/** `engines.node` ranges (>=, >, <=, <, ^, ~, x, hyphen, ||); a form it does not know never refuses. */
export function satisfies(version, range) {
  const num = (v) => [...v.split('.').map((x) => (/^\d+$/.test(x) ? Number(x) : 0)), 0, 0, 0].slice(0, 3);
  const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const v = num(version);
  return range.split('||').some((part) => {
    const hyphen = /^v?([\d.]+)\s+-\s+v?([\d.]+)$/.exec(part.trim());
    if (hyphen) {
      const hi = hyphen[2].split('.');
      const upTo = cmp(v, num(hyphen[2])) <= 0 || v.slice(0, hi.length).every((n, i) => n === Number(hi[i]));
      return cmp(v, num(hyphen[1])) >= 0 && upTo;
    }
    const terms = part
      .trim()
      .replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1')
      .split(/\s+/)
      .filter(Boolean);
    return terms.every((t) => {
      const m = /^(>=|<=|>|<|=|\^|~)?v?(\d+(?:\.(?:\d+|[x*]))*|[x*])$/i.exec(t);
      if (!m) return true;
      const fixed = m[2].split('.').filter((x) => /^\d+$/.test(x)).length;
      const w = num(m[2]);
      const c = cmp(v, w);
      switch (m[1]) {
        case '>=':
          return c >= 0;
        case '>':
          return c > 0;
        case '<=':
          return c <= 0;
        case '<':
          return c < 0;
        case '^':
          return c >= 0 && (w[0] ? v[0] === w[0] : v[0] === 0 && (w[1] ? v[1] === w[1] : v[1] === 0));
        case '~':
          return c >= 0 && v[0] === w[0] && (fixed < 2 || v[1] === w[1]);
        default:
          return v.slice(0, fixed).every((n, i) => n === w[i]);
      }
    });
  });
}

// designq 2026-10-02: `--font-display: var(--font-sora)` in the plain `@theme` block is computed on :root, where the
// next/font variable (set on <html>/<body>) does not exist, so the whole site silently shows the system font.
function fontTokens(root) {
  const file = 'src/app/globals.css';
  if (!existsSync(join(root, file))) return [];
  const text = readFileSync(join(root, file), 'utf8');
  return [...text.matchAll(/@theme\s*\{[^}]*\}/g)].flatMap((block) =>
    [...block[0].matchAll(/--font-[\w-]+\s*:\s*var\([^;]*;?/g)].map((m) => {
      const before = text.slice(0, block.index + m.index).split('\n');
      return {
        file,
        line: before.length,
        col: (before.at(-1)?.length ?? 0) + 1,
        rule: 'font-token-not-inline',
        code: 'FONT_TOKEN_NOT_INLINE',
        found: m[0],
        reason:
          'A font mapped to a variable in the plain `@theme` block never shows: the page falls back to the system font.',
        replacement:
          "load the font in src/app/layout.tsx with `variable: '--font-body'` or `'--font-heading'` (its `.variable` class on <html>) and leave the `@theme inline` block of globals.css as it is; or put this line in that `@theme inline` block.",
      };
    }),
  );
}

// Francesc 2026-10-01: an app without user accounts never shows "Sign in" / "Create an account". The header hides them
// with `accounts: false`; any other link to /login or /register is refused until the app has accounts (T1 2026-10-08:
// the built-in account pages answer 404 then, so a `redirect('/login')` would land on a 404 too).
const AUTH_LINK = /(?:href=\{?|redirect\()\s*['"`]\/(?:login|register)\b[^'"`]*['"`]/g;
// the header and the built-in account pages (src/app/(accounts)/: 404 while `accounts` is false)
const authOwn = (f) => f === 'src/components/site-header.tsx' || f.startsWith('src/app/(accounts)/');
function authLinks(root, files) {
  const site = join(root, 'src/lib/site.ts');
  if (!existsSync(site) || !/\baccounts:\s*false\b/.test(readFileSync(site, 'utf8'))) return [];
  return files
    .filter((f) => !authOwn(f))
    .flatMap((file) => {
      const text = readFileSync(join(root, file), 'utf8');
      return [...text.matchAll(AUTH_LINK)].flatMap((m) => {
        const before = text.slice(0, m.index).split('\n');
        if (/^\s*(?:\/\/|\/?\*)/.test(before.at(-1) ?? '')) return []; // a comment
        return {
          file,
          line: before.length,
          col: (before.at(-1)?.length ?? 0) + 1,
          rule: 'auth-link-without-accounts',
          code: 'AUTH_LINK_WITHOUT_ACCOUNTS',
          found: m[0],
          reason:
            'The app has no user accounts (`accounts: false` in src/lib/site.ts), so it must not link to sign-in or sign-up.',
          replacement:
            'remove the link; or, if the app really has accounts, set `accounts: true` in src/lib/site.ts (the header then shows Sign in / Get started).',
        };
      });
    });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const findings = checkWorkerSafe();
  if (process.argv.includes('--json')) {
    console.log(
      JSON.stringify({
        ok: !findings.some((f) => !f.warning),
        findings: findings.map((f) => ({ ...f, reason: undefined })),
      }),
    );
  } else {
    for (const f of findings.slice(0, MAX))
      console.error(
        `${f.warning ? 'WARNING ' : ''}${f.code}  ${f.file}:${String(f.line)}:${String(f.col)}  [${f.rule}]\n` +
          `  ${f.code === 'NODE_ONLY_API_IN_APP_CODE' ? 'Your preview and your published site run on Cloudflare Workers. ' : ''}${f.reason} Found: ${f.found}\n` +
          `  Use instead: ${f.replacement}`,
      );
    if (findings.length > MAX) console.error(`… and ${String(findings.length - MAX)} more`);
  }
  if (findings.some((f) => !f.warning)) process.exitCode = 1;
}
