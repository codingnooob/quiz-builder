// B2-PJ7: `npx cap add` writes the app id and name into android/ and ios/ once, from whatever capacitor.config.ts saw
// then (on the Sprite: `com.totalum.app` / `App`). A committed android/ or ios/ must still build as THIS project, so
// every build re-applies MOBILE_APP_ID / MOBILE_APP_NAME. Idempotent. The Android `namespace` (the Java package of
// MainActivity and R) is left alone: the installed package is `applicationId`, which may differ from it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const edit = (file, fn) => existsSync(file) && writeFileSync(file, fn(readFileSync(file, 'utf8')));
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const androidString = (s) => xml(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'");

export function setAndroidIdentity(dir, appId, appName) {
  edit(join(dir, 'app/build.gradle'), (g) =>
    g.replace(/applicationId(\s*=?\s*)(["'])[^"']+\2/g, `applicationId$1"${appId}"`),
  );
  edit(join(dir, 'app/src/main/res/values/strings.xml'), (s) => {
    const set = (name, value) =>
      s.replace(new RegExp(`(<string name="${name}"[^>]*>)[^<]*(</string>)`), (_, a, b) => a + value + b);
    s = set('package_name', appId);
    s = set('custom_url_scheme', appId);
    if (appName) for (const n of ['app_name', 'title_activity_main']) s = set(n, androidString(appName));
    return s;
  });
}

export function setIosDisplayName(dir, appName) {
  if (!appName) return;
  edit(join(dir, 'App/App/Info.plist'), (p) =>
    p.replace(
      /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/,
      (_, a, b) => a + xml(appName) + b,
    ),
  );
}
