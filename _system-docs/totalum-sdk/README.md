# Built-in integrations — `totalum-sdk`

This project already has e-mail, AI (text, images, video, speech, vision, embeddings), file storage, real-time,
scheduled jobs, web scraping and crawling, a cloud browser, PDF, document scanning, payments and the users' own
connected accounts (Google, Microsoft, Slack, …), paid for by the project. Use them through `totalum-sdk` (AI in the app: the AI SDK through `@/agents/model`, `ai.md`) — never add
another SDK, API or key for any of them.

## Do exactly this

1. Call the SDK **on the server only**: a route handler (`src/app/api/**/route.ts`), a server action (`'use server'`)
   or a server component. Never import `totalum-sdk` in a `'use client'` file (`totalum-sdk/react` is the exception).
2. Import the ready instance — it needs no configuration: `import { totalum } from 'totalum-sdk';`
3. Totalum sets `TOTALUM_PROJECT_KEY`, `TOTALUM_SDK_API_URL` and `TOTALUM_AI_BASE_URL` in the preview, the published
   site and your sandbox. Never create, ask for or hard-code a key, and never read these in client code.
4. `try`/`catch` every call, `console.error` the error and return a clear error to the page. The code of a failure is
   `err.errorCode` (`isTotalumError(err)` from `totalum-sdk`), never `err.code`.
5. Read the one recipe you need below, copy its code, then check once at the end (`npm run check`).

## Recipes — one file per feature

| Feature | Recipe | Never install |
|---|---|---|
| E-mail | `email.md` | `resend`, `nodemailer`, `@sendgrid/*` |
| AI in the app: text, chat, streaming, JSON, classify, vision, images (AI SDK + `model()`) | `ai.md` | `openai`, `@anthropic-ai/sdk`, `@google/genai`, `@openrouter/sdk`, `langchain` |
| AI video; design images while building | `images-video.md` | `replicate`, `@fal-ai/*`, `sharp` for generation |
| Text-to-speech, speech-to-text | `speech.md` | `elevenlabs`, `@deepgram/sdk`, `openai` |
| Files: upload, list, download, private files | `files.md` | `@aws-sdk/*`, `cloudinary`, `uploadthing`, `multer` |
| Document scan / OCR (images, multi-page PDFs) | `scan.md` | `tesseract.js`, `pdf-parse`, `pdfjs-dist` |
| Vector search: chat with documents, semantic search, image search | `vectors.md` | `@pinecone-database/*`, `chromadb`, `pgvector`, `langchain` |
| Web scraping, crawling, search, screenshots | `web.md` | `@mendable/firecrawl-js`, `cheerio` scrapers, `puppeteer` |
| Cloud browser (click, type, log in, download) | `browser.md` | `puppeteer`, `playwright`, `@browserbasehq/sdk` |
| PDF from HTML or a URL | `pdf.md` | `pdfkit`, `jspdf`, `puppeteer` |
| The user's own accounts of ~1,500 apps (Google Calendar + Meet, Gmail, Drive, Outlook, Slack, HubSpot, Stripe, SendGrid, …); their events: `connections-events.md` | `connections.md` | `googleapis`, `@microsoft/microsoft-graph-client`, `@slack/web-api`, `@hubspot/api-client`, `dropbox`, `@composio/*`, an OAuth library |
| Payments (Stripe Checkout) | `payments.md` | `stripe`, unless the user asks for their own Stripe keys (`payments.md`) |
| Real-time: chat, notifications, presence | `realtime.md` | `socket.io`, `pusher`, `ably` |
| Scheduled jobs | `cron.md` | `node-cron`, `setInterval`, Vercel cron |
| A complex AI agent: tools, memory, approvals, background runs | `agents.md` | `langchain`, `@mastra/*`, a provider SDK |

Each recipe's `Call | Returns` table is generated from the installed `totalum-sdk`'s types. Full reference with every
option and return type: `node_modules/totalum-sdk/totalum-sdk.md` (read only the section you need). A method marked
**Deprecated** there still works but prints a warning: use the name it points to. AI models: presets `fast`, `smart`, `reasoning`, `vision`, `image`, `image-edit`, `video`, `tts`, `stt`, `embed`, `embed-image` (see `ai.md`). A library that wants an OpenAI-compatible
client gets `totalum.ai.gatewayConfig()` → `{ baseURL, apiKey }` (server only).

## Costs

Every paid call is charged in credits to the project owner and returns what it cost in `usage.credits`. The
current price of each unit (an e-mail recipient, a browser minute, a scrape, …) is in the public price list,
`curl -s "$TOTALUM_SDK_API_URL/v1/pricing"` (credits only); never quote a price from memory. Use `fast`
unless the user asks for quality, generate media once and store it (`store: true`), never call a paid built-in on
every page view: call it on a user action or a cron job and save the result in the database.

## Known errors → fix

| Error code | Meaning | Fix |
|---|---|---|
| `SDK_NOT_CONFIGURED` | the code ran in the browser, or a script without the environment | move the call into a route handler / server action |
| `NODE_ONLY` | a Node-only method (`ai.video.wait`) inside the app | store the `jobId`, read `totalum.ai.video.get(jobId)` later |
| `DEV_RECIPIENT_NOT_ALLOWED` | Totalum's test environment only delivers to allowed addresses | not a bug in your code; keep the call |
| `INSUFFICIENT_CREDITS` (402) | the account has no credits | show "temporarily unavailable"; never retry in a loop |
| `FEATURE_LIMIT_REACHED` (429), `FEATURE_DISABLED` (403) | the project owner switched the feature off or its monthly budget is spent — `errorDetails.feature` names it (`ai_video`, `ai_image`, `ai_text`, `ai`, `speech`, `web`, `browser`, `scan`, `storage`, `email`, … or `all`) | show "this feature is not available right now"; the owner turns it back on in the project's limits; never call a provider directly to work around it |
| `RATE_LIMITED` (429) | more than 100 built-in calls in one second from this project (the SDK already retried it twice) | never fire many calls at once: process lists in small groups (≤ 10 per `Promise.all`), or in a cron job; show "busy, try again" |
| `RATE_LIMIT_EXCEEDED` (429), `errorDetails.scope: 'visitor'` | one visitor (IP) caused more than `site.paidCallsPerVisitorPerMinute` (default 20) AI, web, browser or screenshot calls this minute | show "try again in a minute" (`Retry-After` says when); never retry in a loop; raise the number in `src/lib/site.ts` only when the owner asks |
| `AI_MEDIA_PAUSED_THIS_HOUR` (429) | the app spent a lot of credits this hour, so image, video and speech AI wait until the hour ends (UTC); text AI and everything else keep working | show "image generation is busy, try again later" (`Retry-After` / `errorDetails.resetsAt` say when); never retry in a loop |
| `URL_NOT_ALLOWED` (400) | a private, local or Totalum URL given to a vendor | pass the stored file's `key` (or its files URL to scan/speech/vision) |
| `FILE_KEY_FORBIDDEN` (403) | a file key of another project | use the keys this project stored |
| `AI_MODEL_UNKNOWN` | a model name that does not exist | use a preset (`fast`, `smart`, `reasoning`, …) |
| `AI_PROVIDER_UNAVAILABLE` (502/503) | the model provider failed | show a retry button; do not loop |
| `REALTIME_TICKET_EXPIRED` / `REALTIME_TICKET_INVALID` (socket close 4401) | a ticket used late or twice | fetch a new ticket for every connection |
