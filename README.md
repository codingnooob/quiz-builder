# Totalum project

A Next.js 16 app built with [Totalum](https://totalum.app). It runs on Cloudflare Workers; its data is a D1 (SQLite)
database used through Drizzle ORM (`src/db/`), with better-auth for accounts (`src/lib/auth.ts`).

## Run locally

You need Node 22 and npm. On Linux, the local Workers runtime needs glibc 2.35 or newer (Ubuntu 22.04, Debian 12).

1. Download the source code and its `.env` from Totalum (with the VCaaS API: `GET /api/v1/vcaas/projects/<id>/source-code`
   and `GET …/github/env`, whose `envDev` is the file), and put the `.env` in the project folder.
2. `npm ci`
3. `npm run dev`, then open <http://localhost:3100> (`PORT=4000 npm run dev` for another port).

`npm run dev` first applies the migrations in `drizzle/` to the database it serves: with `TOTALUM_ENV=dev` and a
`TOTALUM_PROJECT_KEY` (the `.env` above), your project's dev database on Totalum, the one the preview shows, so rows
you create there appear in the preview too; otherwise (a project without a dev database, or no key) a local database
in `.wrangler/`, which never reaches Totalum (to start it again empty, stop the server and delete `.wrangler/state`).

The built-in integrations (e-mail, AI, files, …) call Totalum with `TOTALUM_PROJECT_KEY` from `.env` and are billed
to your project as usual. Without a key the app still runs, and only those calls fail with `SDK_NOT_CONFIGURED`.

## Commands

- `npm run db:generate`: after you change `src/db/schema.ts`, writes the next migration to `drizzle/`. The next
  `npm run dev` applies it (or run `npm run db:migrate`, or `npm run db:migrate -- --local` for the local database).
- `npm run db:migrate`: applies the migrations to the project's database on Totalum, the one `TOTALUM_ENV` in `.env`
  selects (`dev` or `live`).
- `npm run build:preview`: the Cloudflare Workers build Totalum deploys. `npx wrangler dev` then serves that build on
  <http://localhost:8787> in the Workers runtime, on the local database in `.wrangler/`.
