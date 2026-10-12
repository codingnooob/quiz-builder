# npm packages on Workers

This project is built by Next.js 16 with Turbopack, then bundled by OpenNext into one Cloudflare Worker
(`nodejs_compat`). Turbopack resolves every package through its `node` build, never its `workerd` build, so a
package can pass `npm run check` and still fail or hang on the preview.

- **Middleware:** write `src/middleware.ts` (`export function middleware`). Never create `src/proxy.ts`: on Workers
  it adds about 1.2 MB compressed (an unused image library and its wasm) to the Worker.
- **E-mail and payments** come from `totalum-sdk` (`_system-docs/totalum-sdk/README.md`). To design an e-mail,
  `render()` from `@react-email/components` works; pass its HTML to the SDK. If the user insists on their own
  Stripe or Resend account, `stripe` and `resend` also work (Totalum keeps `stripe` on its Workers build; own Stripe
  keys: `totalum-sdk/payments.md`, last section).
- **Never works:** native addons (`sharp`, `bcrypt`, `argon2`, `better-sqlite3`, `canvas`, `pg-native`); packages
  that compile code at run time (`eval`, `new Function`, e.g. the `firebase` Firestore client: use its REST API);
  importing a raw `.wasm` file for its default export (e.g. `@cf-wasm/photon`).
- **Node 22 everywhere** (the Sprite, the preview build, the Android/iOS build): a package whose `engines` refuses
  Node 22 fails `npm ci` there. When `npm install` says `EBADENGINE`, pick a version that supports Node 22
  (`npm view <package>@<version> engines`) and install it with `--save-exact`, or use another package. Never install
  with `--engine-strict=false` or `--force`: `npm run check` refuses the lock (`PACKAGE_NEEDS_OTHER_NODE`). The same
  for a peer conflict (`ERESOLVE`, `DEPENDENCY_CONFLICT`): pick versions that agree, never `--legacy-peer-deps`.
- **Databases:** only this project's database through `@/db`. No `pg`, `postgres`, `mysql2`, `mongodb` or Prisma.
- **Build config:** there is no `webpack()` hook and no webpack plugin; `next.config.ts` belongs to Totalum.
- **Any other package** that fails or hangs only on the preview: use its `fetch`-based option or call its HTTP API
  with `fetch`, and tell the user which package could not run on Workers.
