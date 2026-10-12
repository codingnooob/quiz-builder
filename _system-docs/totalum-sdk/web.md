# Web scraping, crawling, search, screenshots — `totalum.web`

Firecrawl behind Totalum: JavaScript-rendered pages, anti-bot retries, clean markdown. Server-side only. Never
install `@mendable/firecrawl-js`, `puppeteer` or a `fetch` + `cheerio` scraper (blocked on most real sites). To click,
type or log in, use the cloud browser (`browser.md`).

**Limits (design for them):** **one Firecrawl call at a time per project** (scrape, search, map, crawl start —
not `screenshot`; `<project-facts>` names another number if this project has one) and **10 s per call**. Calls fired together
wait in a queue and run one after another (up to 30 s of waiting, then `CONCURRENCY_QUEUE_TIMEOUT`); a page slower than
10 s fails with `PROVIDER_TIMEOUT` (504, not charged). So: scrape a list one URL after another (in a cron job for long
lists, saving progress), use `crawl` for many pages of one site, never `Promise.all` over dozens of URLs.

<!-- totalum-sdk:signatures web -->
| Call | Returns |
|---|---|
| `totalum.web.scrape(url, { formats?, onlyMainContent?, waitFor?, timeout?, proxy?: 'basic' \| 'stealth' \| 'auto', location?, actions?, schema?, prompt?, cacheMaxAgeMs? })` | `{ url, statusCode, metadata, usage, markdown?, html?, rawHtml?, links?, screenshotUrl?, json?, summary?, contentUrl? }` |
| `totalum.web.search(query, { limit?, location?, sources?, timeRange?: 'day' \| 'month' \| 'week' \| 'year', scrapeOptions? })` | `{ web, news?, images?, scraped?, usage }` |
| `totalum.web.map(url, { limit?, search? })` | `{ links, usage }` |
| `totalum.web.crawl(url, { limit?, scrapeOptions?, maxDepth?, includePaths?, excludePaths?, webhook? })` | `{ jobId, estimatedCredits? }` |
| `totalum.web.crawlStatus(jobId)` | `{ jobId, status: 'expired' \| 'completed' \| 'queued' \| 'running' \| 'failed' \| 'cancelled', total, completed, creditsUsed, data, next?, resultUrl? }` |
| `totalum.web.cancelCrawl(jobId)` | `{ jobId, status: 'expired' \| 'completed' \| 'queued' \| 'running' \| 'failed' \| 'cancelled', total, completed, creditsUsed, data, next?, resultUrl? }` |
| `totalum.web.screenshot({ url?, html?, fullPage?, viewport?, format?: 'png' \| 'jpeg' \| 'webp', waitForSelector?, inline? })` | `{ key, url, format: 'png' \| 'jpeg' \| 'webp', base64?, usage }` |
<!-- /totalum-sdk:signatures -->

- Charged per call, `crawl` per page (`/v1/pricing`, README; a job: poll `crawlStatus`; pages already crawled are
  charged when you `cancelCrawl`); `screenshot` stores a PNG.
- `formats?: ['markdown' | 'html' | 'links' | 'summary' | 'json']`; `search` `limit` ≤ 100, `sources: ['web' | 'news']`.

`formats: ['json']` with `schema` (JSON Schema) or `prompt` returns structured data in `json` (e.g. every product's
name and price). A crawl `limit` is capped by the plan (Free: 20 pages). Paths are regexes on the URL path:
`includePaths: ['^/blog/.*']`.

## Recipe — scrape a page on a button

```ts
// src/app/api/import/route.ts
import { totalum } from 'totalum-sdk';
import { currentSession } from '@/lib/auth';

export async function POST(req: Request) {
  const session = await currentSession();
  if (!session) return Response.json({ ok: false, error: 'Sign in' }, { status: 401 });
  const { url } = (await req.json()) as { url: string };
  if (!/^https?:\/\//.test(url)) return Response.json({ ok: false, error: 'A web address' }, { status: 400 });
  try {
    const page = await totalum.web.scrape(url, { formats: ['markdown'], onlyMainContent: true });
    return Response.json({ ok: true, data: { title: page.metadata.title, markdown: page.markdown } });
  } catch (err) {
    console.error('scrape failed', err);
    return Response.json({ ok: false, error: 'That page could not be read' }, { status: 502 });
  }
}
```

## Recipe — crawl a site (a job: start, then poll)

```ts
// POST /api/crawls: start and save the job
const { jobId } = await totalum.web.crawl(siteUrl, { limit: 10, scrapeOptions: { formats: ['markdown'] } });
await db.insert(crawls).values({ id: jobId, siteUrl, status: 'running', createdAt: new Date().toISOString() });

// POST /api/crawls/[id]: the page calls it every 3 s until the status is no longer 'running'
const job = await totalum.web.crawlStatus(id);
if (job.status !== 'running') {
  await db.batch([
    db.update(crawls).set({ status: job.status }).where(eq(crawls.id, id)),
    ...job.data.map((p) =>
      db.insert(crawlPages).values({ id: crypto.randomUUID(), crawlId: id, url: p.metadata.sourceURL,
        title: p.metadata.title ?? null, markdown: (p.markdown ?? '').slice(0, 50_000) }),
    ),
  ]);
}
return Response.json({ ok: true, data: { status: job.status, completed: job.completed, total: job.total } });
```

A crawl of 10 pages takes 10–60 s. A scheduled crawl (every night) is the same pair of calls from a cron job
(`cron.md`), the second one on the next tick. `job.creditsUsed` counts Firecrawl's pages, not Totalum credits.

Errors: `URL_NOT_ALLOWED` (a private, local or Totalum URL), `SCRAPE_BLOCKED` (the site blocked every attempt),
`SCRAPE_FAILED`, `SEARCH_FAILED`, `SCREENSHOT_FAILED`, `JOB_NOT_FOUND` (404, another project's job),
`PROVIDER_TIMEOUT` (504, the page took over 10 s), `CONCURRENCY_QUEUE_TIMEOUT` / `CONCURRENCY_QUEUE_FULL` (429, too
many calls at once: retry after `retryAfter` s),
`VALIDATION_ERROR` (400, a crawl `limit` above the plan's pages per crawl).
