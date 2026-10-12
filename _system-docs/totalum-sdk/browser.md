# Cloud browser — `totalum.browser` (Browserbase)

A real Chrome in the cloud, driven over HTTPS, so it works inside the app (a Worker). Use it when a page needs
clicks, typing, a login or a download; to just read a page use `web.md` (cheaper, faster). Never install
`puppeteer`, `playwright`, `@browserbasehq/sdk` or `chrome-aws-lambda` (they cannot run here).
Charged per started minute (`/v1/pricing`, README). **Always `close()` in `finally`** — an open session keeps billing.

**Limits (design for them):** at most **3 sessions open at once per project — 1 on the free plan**
(`<project-facts>` names this project's number when it is not 3). One more `session()` waits in a queue until one closes — up to 60 s, then
`CONCURRENCY_QUEUE_TIMEOUT` (429). One call (a command, an `actions` batch or a program) runs at most **60 s**; a
session with **no call for 60 s is closed** (`SESSION_EXPIRED`) — while a person uses the live view, keep it with
`totalum.browser.sessions.get(s.id)` every ~30 s. So: reuse one session for many pages, go through a list one item after
another (or in at most that many sessions), never one session per item under `Promise.all`.

<!-- totalum-sdk:signatures browser -->
| Call | Returns |
|---|---|
| `totalum.browser.session({ proxy?, solveCaptchas?, captcha?, stealth?: 'basic' \| 'off' \| 'verified', fingerprintOs?: 'mobile' \| 'windows' \| 'mac' \| 'linux' \| 'tablet', timeoutMinutes?, keepAlive?, context?, contextId?, blockAds?, allowedDomains?, ignoreCertificateErrors?, caCertificateIds?, extensionId?, metadata?, logSession?, recordSession?, region?: 'eu' \| 'us-west-2' \| 'us-east-1' \| 'eu-central-1' \| 'ap-southeast-1' \| 'us', locale?, timezone?, geolocation?, userAgent?, extraHeaders?, blockResources?, device?, captureDownloads?, viewport? })` | `BrowserSession` |
| `totalum.browser.sessions.list({ status?, metadata?, limit?, cursor? })` | `{ items, nextCursor? }` |
| `totalum.browser.sessions.get(id)` | `BrowserSession` |
| `totalum.browser.programs.get(programId)` | `{ programId, sessionId, status: 'completed' \| 'running' \| 'failed' \| 'pending' \| 'timed_out', steps, vars, startedAt, credits, result?, endedAt? }` |
| `totalum.browser.programs.wait(programId, { intervalMs?, timeoutMs? })` | `{ programId, sessionId, status: 'completed' \| 'running' \| 'failed' \| 'pending' \| 'timed_out', steps, vars, startedAt, credits, result?, endedAt? }` |
<!-- /totalum-sdk:signatures -->

`const s = await totalum.browser.session({ captureDownloads?, viewport?, locale?, timezone?, solveCaptchas?,
proxy?: { enabled: true, country: 'ES' } })` → a session. Its methods (each one HTTPS round trip):

| Method | Returns |
|---|---|
| `s.goto(url)`, `s.back()`, `s.reload()` | `{ url, status, redirected }` |
| `s.pageInfo()` | `{ url, title }` |
| `s.click(target)`, `s.type(target, text, { clear? })`, `s.press('Enter')`, `s.select(target, value)` | — |
| `s.waitFor({ target, state?: 'visible' })` or `s.waitFor({ ms: 1000 })` or `s.waitFor({ navigation: true })` | `{ matched }` |
| `s.content({ format: 'text' \| 'markdown' \| 'html', target? })` | the page (or element) as a string |
| `s.extract({ schema, prompt? })` | the page's data as your JSON schema says (an AI call) |
| `s.screenshot({ scope?: 'fullPage' \| 'element', target? })` | `{ key, url, width, height }` — a stored PNG |
| `s.pdf()` | `{ key, url, pages }` — the page as a stored PDF |
| `s.evaluate('document.title')` | the expression's value (≤ 16 KB script) |
| `s.act('click the cookie banner accept button')` | `{ done, action }` — an instruction in plain words |
| `s.downloads.get({ waitMs: 20000, name? })` (session opened with `captureDownloads: true`) | `{ name, key, bytes, contentType }` — the downloaded file, stored |
| `s.actions([{ type: 'goto', url }, { type: 'click', target }, …])` | up to 20 commands in one round trip |
| `s.close()` | `{ minutes, creditsUsed }` |

Screenshots, PDFs and downloads are **private** files of this project: `url` is a signed link valid for 1 hour — store
the `key` and serve it later with `totalum.files.getSignedUrl(key)` (`files.md`).

`target` is a CSS selector (`'#email'`, `'button[type=submit]'`), `{ text: 'Sign in' }`, `{ role: 'button', name:
'Search' }` or `{ xpath }`. A command that fails throws `ACTION_FAILED` / `ACTION_TIMEOUT` with the reason.

## Recipe — fill a search form, read the results, keep a screenshot

```ts
// src/app/api/price-check/route.ts
import { totalum } from 'totalum-sdk';
import { currentSession } from '@/lib/auth';

export async function POST(req: Request) {
  const session = await currentSession();
  if (!session) return Response.json({ ok: false, error: 'Sign in' }, { status: 401 });
  const { query } = (await req.json()) as { query: string };
  const s = await totalum.browser.session();
  try {
    await s.goto('https://shop.example.com');
    await s.type('input[name=q]', query, { clear: true });
    await s.press('Enter');
    await s.waitFor({ target: '.results', state: 'visible' });
    const results = await s.content<string>({ format: 'markdown', target: '.results' });
    const shot = await s.screenshot<{ key: string; url: string }>();
    // save shot.key (and the results) in your table here
    return Response.json({ ok: true, data: { results, screenshotUrl: shot.url } });
  } catch (err) {
    console.error('browser check failed', err);
    return Response.json({ ok: false, error: 'The site could not be checked' }, { status: 502 });
  } finally {
    await s.close();
  }
}
```

A site login needs the user's credentials: ask the user for a dedicated account and never hard-code passwords.

## Recipe — download a file a site generates

```ts
const s = await totalum.browser.session({ captureDownloads: true });
try {
  await s.goto('https://example.com/reports');
  await s.click({ text: 'Export CSV' });
  const file = await s.downloads.get<{ name: string; key: string; bytes: number }>({ waitMs: 20_000 });
  // file.key is a private file of this project: read it with totalum.files.stream(file.key)
} finally {
  await s.close();
}
```

A task longer than a request (many pages, minutes) runs in steps from a cron job, saving progress in the database
(`agents.md` shows the pattern). A site that shows a CAPTCHA: `session({ solveCaptchas: true })`.

Errors: `ACTION_FAILED`, `ACTION_TIMEOUT` (the element never appeared: `waitFor` it first), `SESSION_EXPIRED` /
`SESSION_NOT_FOUND` (open a new session), `SESSION_LIMIT_REACHED` (the plan's concurrent sessions), `SESSION_BUSY`
(two calls at once on one session), `CONCURRENCY_QUEUE_TIMEOUT` / `CONCURRENCY_QUEUE_FULL` (429: too many sessions
at once — retry after `retryAfter` s, or open fewer), `DOWNLOAD_TOO_LARGE`, `CAPTCHA_UNSOLVED`, `URL_NOT_ALLOWED`.
