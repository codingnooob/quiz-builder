# "Why is my site slow?" — measure, then explain

Never answer a speed question from reading the code alone, and never write "I haven't measured". Measure first (one
or two Bash calls), then answer with the numbers.

## 1. Time the pages

The published URL is in `<project-facts>` (not published yet: the preview URL). Time the page the owner named, else
`/`, ten times, in one Bash call:

```bash
URL='https://<published-host>/'
for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null -w '%{time_starttransfer} %{http_code} %{size_download}\n' "$URL"; done
```

`time_starttransfer` is the server's answer time (TTFB) in seconds. Report the median and the slowest. The FIRST
request after the site sat idle for a minute or more is slower (≈ 0.3–0.6 s): the server starts. That is the
platform, not the app's code; nothing in the project changes it, so say so plainly and do not "fix" it.

## 2. What real visitors got (last 7 days)

```bash
cat > scripts/speed-check.ts <<'TS'
import { totalum } from 'totalum-sdk';
const q = { env: 'live', dimension: 'path', metric: ['page_views', 'ttfb_p50', 'ttfb_p95'], limit: 10 } as const;
console.log(JSON.stringify((await totalum.analytics.site(q)).top));
TS
npx tsx scripts/speed-check.ts; rm scripts/speed-check.ts
```

TTFB per page in milliseconds (p50 = a typical visit, p95 = the slow ones). No traffic yet: say so and rely on 1.

## 3. The weight of the page

```bash
curl -s "$URL" | grep -oE '<img[^>]+src="[^"]+"' | head
curl -sI '<image-url>' | grep -i content-length
```

An image over ≈ 300 KB, many large photos above the fold, or several font families make a page look slow even when
its TTFB is fast.

## 4. Errors

`npm run logs -- --env live --level error`: a failing call retried or timing out is slow too.

## Then answer

1. The numbers: "Home: 0.18 s typical, 0.52 s the first visit after a quiet minute; /menu 1.4 s (p95 2.1 s)".
2. The cause they point to, in plain words:
   - warm answers ≤ 0.3 s: the server is fast; a slow feel is the images or fonts (3), or the first visit after idle;
   - one page much slower than the rest: its database reads (one `loadPage` batch, joins, an index on the filtered
     column — `database.md`) or a slow outside call on that page;
   - every page slow, warm too: a read or call every page makes (the layout, the header).
3. The fix you propose, and offer to do it. Change nothing unless they asked for the fix.
