# Mobile apps (iOS and Android)

A project is a web app until the user asks for a mobile app. The mobile app is a native shell (Capacitor) that
opens the published site, so everything the user sees is the web app you build in `src/`: make it responsive and
touch-friendly first.

## Turn mobile on (once, when the user asks for a mobile app)

```sh
npm run mobile:enable
```

It adds the pinned Capacitor packages and `capacitor.config.ts` (the shell's settings; the app id, name and URL are
set per build by Totalum). It builds nothing.

## Builds never run here

Never run Gradle, Xcode, `npx cap run`, `npm run build:mobile` or `npm run mobile:setup` in this sandbox: there is no
Android or iOS toolchain, and they refuse to run. Builds run on Codemagic from the **Mobile** tab, from the latest
saved version of this project; signing and store uploads are Totalum's. The app opens the published site: the user
publishes first, then presses **Build** in the Mobile tab (a build before the first publish is refused); with "send to
stores on publish" on, publishing builds it.

Totalum's build servers run **one build at a time** for everyone: a build may wait queued (position n) and starts by
itself; the user can cancel it while it waits. **Each project can build at most once per hour** (a publish that sends
to the stores counts too): the Build button then says when it can build again. So fix everything before the user
presses Build, and never ask for a rebuild "to try". See where a build stands:

```sh
npm run mobile:status
```

## A failed build ("the mobile build fails")

The prompt quotes the latest failed build when there is one. For the full log:

```sh
npm run mobile:logs
```

Fix the cause in the files the log names (`capacitor.config.ts`, `mobile/shell/`, `package.json`, or `android/` /
`ios/` when the project has them), then ask the user to press **Build** again. You cannot rebuild it yourself.

## Files

- `capacitor.config.ts` — shell settings (after `mobile:enable`); `mobile/shell/` — the offline and loading pages.
- `android/`, `ios/` — only when a native change is needed (icons, permissions): `npx cap add android` creates it.
  Commit it as created: every build sets the app's id and name itself (the Mobile settings), whatever
  `applicationId` / `app_name` it holds.
- `store/` — store listing texts and screenshots; check them with `npm run mobile:store`.
