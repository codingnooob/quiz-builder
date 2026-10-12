// The ONE list of Node-only code that works on the Sprite but fails on Cloudflare Workers (A7.14, plan 06 §5.4).
// Two consumers, so they never drift: `npm run check-worker-safe` (run first by `npm run build:preview`) and the ESLint
// rule `totalum/no-node-only-apis`. Platform-owned.

const imports = (names) =>
  new RegExp(
    String.raw`(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s*)['"](?:${names})(?:/[^'"]*)?['"]`,
    'gm',
  );

export const RULES = [
  {
    id: 'browser-connect-url',
    pattern: /\.connectUrl\s*\(|\bconnectOverCDP\s*\(/g,
    reason: 'A Worker cannot hold a CDP connection.',
    use: 'the HTTPS browser actions — session.goto(url), session.click(...), session.content() (_system-docs/totalum-sdk/README.md).',
  },
  {
    id: 'ai-video-wait',
    pattern: /\bai\.video\.wait\s*\(/g,
    reason: 'A Worker request cannot wait minutes for a video.',
    use: 'ai.video.generate() → store the jobId → the ai.video.completed webhook, or ai.video.get(jobId) on refresh.',
  },
  {
    id: 'playwright-import',
    pattern: imports('playwright|playwright-core|puppeteer|puppeteer-core|chrome-aws-lambda'),
    reason: 'A Worker cannot launch a browser.',
    use: 'totalum.browser.session() (a server-side browser), or totalum.web.screenshot() for a screenshot.',
  },
  {
    id: 'node-builtin',
    pattern: new RegExp(
      `${imports('(?:node:)?(?:fs|child_process|worker_threads|cluster|dgram|net|tls|v8|vm)').source}|\\bhttps?\\.createServer\\s*\\(`,
      'gm',
    ),
    reason: 'A Worker has no filesystem, no processes and no listening sockets.',
    use: 'totalum.files (R2) instead of the filesystem; a route handler instead of a server.',
  },
  {
    id: 'process-exit',
    pattern: /\bprocess\.(?:exit|abort|kill)\s*\(|\bprocess\.on\s*\(\s*['"]SIG/g,
    reason: 'A Worker isolate has no process lifecycle.',
    use: 'return a Response, or throw.',
  },
  {
    id: 'native-module',
    pattern: imports('better-sqlite3|sharp|canvas|bcrypt|node-pty'),
    reason: 'A Worker cannot load native (.node) modules.',
    use: 'the database through `db` (@/db), better-auth for passwords, totalum.files / totalum.ai.image for images.',
  },
  {
    id: 'long-lived-connection',
    pattern:
      /^(?:export\s+)?(?:(?:const|let|var)\s+\w+\s*=\s*)?(?:setInterval\s*\(|new\s+WebSocket\s*\()|\bnet\.connect\s*\(/gm,
    reason: 'A Worker keeps nothing alive between requests.',
    use: 'do the work per request, or schedule it with totalum.cron; real-time goes through totalum.realtime.',
    serverOnly: true,
  },
  {
    // not Node-only: React's no-JS form postback (what `npm run try:form` and a click before hydration send) calls the
    // action's `$$IS_SIGNATURE_EQUAL`, which suspends on the pending promise `.bind()` made; the retry renders again,
    // binds again and never settles — `next dev` grew 1.0 → 4.5 GB in one 70 s request (research 59 §9, os05).
    id: 'bound-action-state',
    code: 'BOUND_ACTION_IN_USE_ACTION_STATE',
    pattern: /[\w$.]*\.bind\s*\(/g,
    clientOnly: true,
    requires: /\buseActionState\b/,
    reason:
      'A Server Action bound with .bind() in a client component and given to useActionState hangs the no-JavaScript form post (try:form, a click before the page loads) until the server runs out of memory.',
    use: 'a hidden input (<input type="hidden" name="partId" value={partId} />, read with form.get), or .bind() in the server component page and pass the bound action as a prop.',
  },
  {
    id: 'edge-runtime',
    pattern: /export\s+const\s+runtime\s*=\s*['"]edge['"]/g,
    reason: 'Totalum runs the Node-compatible Worker runtime, not the edge runtime.',
    use: 'remove the line.',
  },
  {
    // not Node-only: the site's Content-Security-Policy (worker.ts, B3-AT5) runs an inline script only with the
    // response's nonce, and `npm run dev` sends no policy, so the script works there and silently not on the site
    id: 'inline-script-nonce',
    code: 'INLINE_SCRIPT_WITHOUT_NONCE',
    pattern:
      /<[sS]cript\b(?=[^>]*dangerouslySetInnerHTML)(?![^>]*\b(?:src|nonce)\s*=)(?![^>]*application\/(?:ld\+)?json)|<[sS]cript\b(?![^>]*\b(?:src|nonce|type)\s*=)[^>]*>\s*\{/g,
    reason: "The site's Content-Security-Policy blocks an inline script without the page's nonce.",
    use: "nonce={await scriptNonce()} (import { scriptNonce } from '@/lib/script-nonce') on the <script>/<Script> in a server component, or the code in a client component's useEffect.",
  },
];

// Comments out, positions kept, so a line and column still point at the source.
const blank = (s) => s.replace(/[^\n]/g, ' ');
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:])\/\/[^\n]*/g, blank);

/** Every finding in one file's text: `{ rule, found, line, col, index }` (line and col 1-based). */
export function scan(text) {
  const code = stripComments(text);
  const client = /^\s*['"]use client['"]/.test(code);
  /** @type {{ rule: (typeof RULES)[number], found: string, index: number, line: number, col: number }[]} */
  const out = [];
  for (const rule of RULES) {
    if ((rule.serverOnly && client) || (rule.clientOnly && !client)) continue;
    if (rule.requires && !rule.requires.test(code)) continue;
    for (const m of code.matchAll(rule.pattern)) {
      const found = m[0].trim();
      const index = m.index + m[0].indexOf(found);
      const before = code.slice(0, index).split('\n');
      out.push({ rule, found, index, line: before.length, col: (before.at(-1)?.length ?? 0) + 1 });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * The ESLint twin, `totalum/no-node-only-apis` (eslint.config.js): the same findings while the agent writes.
 * @type {import('eslint').ESLint.Plugin}
 */
export const eslintPlugin = {
  rules: {
    'no-node-only-apis': {
      meta: { type: 'problem', schema: [] },
      create: (context) => ({
        Program(node) {
          for (const f of scan(context.sourceCode.text))
            context.report({
              node,
              loc: { line: f.line, column: f.col - 1 },
              message: `[${f.rule.id}] ${f.rule.code ? '' : 'Workers: '}${f.rule.reason} Found: ${f.found}. Use instead: ${f.rule.use}`,
            });
        },
      }),
    },
    // A10.13: a bare OpenRouter id pins one model forever; a preset follows the newest model of its family.
    'no-bare-model-id': {
      meta: { type: 'suggestion', schema: [] },
      create: (context) => {
        const check = (node) => {
          if (node?.type === 'Literal' && typeof node.value === 'string' && MODEL_ID.test(node.value))
            context.report({
              node,
              message: `'${node.value}' pins one model. Use a preset ('fast', 'smart', 'reasoning', 'vision', 'embed', …): it follows the newest model server-side. To pin deliberately: // eslint-disable-next-line totalum/no-bare-model-id -- <reason>`,
            });
        };
        return {
          Property(node) {
            if ((node.key.name ?? node.key.value) === 'model') check(node.value);
          },
          CallExpression(node) {
            if (node.callee.type === 'Identifier' && node.callee.name === 'model') check(node.arguments[0]);
          },
        };
      },
    },
  },
};

/** An OpenRouter model id (`vendor/model[:variant]`), not a path or URL. */
const MODEL_ID = /^[a-z0-9~][\w.-]*\/[\w.:-]+$/i;
