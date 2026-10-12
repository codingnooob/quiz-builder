// `npm run build:mobile` (plan 06 §14): the shell → `cap sync <target>` → Gradle / xcodebuild → mobile-artifacts/.
// Env (set by AM or the Codemagic workflow, never .env): MOBILE_TARGET android|ios, MOBILE_MODE remote|hybrid,
// MOBILE_ARTIFACT debug-apk|apk|aab (android) or simulator-app|ipa (ios), MOBILE_APP_ID, MOBILE_APP_NAME,
// CAP_REMOTE_URL, TOTALUM_VERSION_NAME/CODE, and for a signed Android release only
// TOTALUM_KEYSTORE_PATH/KEY_ALIAS/STORE_PASSWORD/KEY_PASSWORD (without them `apk`/`aab` come out unsigned). An iOS
// `ipa` stops after the Xcode project is prepared: Codemagic's `xcode-project build-ipa` signs and builds it. The web
// build is never touched (A7.15).
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { setAndroidIdentity, setIosDisplayName } from './mobile-identity.mjs';
import { onlyOnCodemagic } from './mobile-paths.mjs';

onlyOnCodemagic();

const TASKS = {
  'debug-apk': ['assembleDebug', 'app/build/outputs/apk/debug'],
  apk: ['assembleRelease', 'app/build/outputs/apk/release'],
  aab: ['bundleRelease', 'app/build/outputs/bundle/release'],
};
const IOS = ['simulator-app', 'ipa'];
const {
  MOBILE_TARGET = 'android',
  MOBILE_MODE = 'remote',
  MOBILE_ARTIFACT = MOBILE_TARGET === 'ios' ? 'simulator-app' : 'debug-apk',
  CAP_REMOTE_URL,
  MOBILE_APP_ID,
  MOBILE_APP_NAME,
  TOTALUM_VERSION_NAME = '1.0.0',
  TOTALUM_VERSION_CODE = '1',
} = process.env;
const ios = MOBILE_TARGET === 'ios';
if (ios ? !IOS.includes(MOBILE_ARTIFACT) : !TASKS[MOBILE_ARTIFACT])
  throw new Error(`MOBILE_ARTIFACT must be one of ${(ios ? IOS : Object.keys(TASKS)).join(', ')}`);
if (MOBILE_MODE !== 'remote' && MOBILE_MODE !== 'hybrid')
  throw new Error('MOBILE_MODE must be remote or hybrid (static export is not built yet)');
if (!CAP_REMOTE_URL || !MOBILE_APP_ID) throw new Error('CAP_REMOTE_URL and MOBILE_APP_ID are required');

const dist = 'mobile/shell/dist';
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const page of ['index.html', 'offline.html']) copyFileSync(join('mobile/shell', page), join(dist, page));
writeFileSync(join(dist, 'config.js'), `window.TOTALUM_REMOTE_URL = ${JSON.stringify(CAP_REMOTE_URL)};\n`);

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
run('npx', ['cap', 'sync', ios ? 'ios' : 'android']);
rmSync('mobile-artifacts', { recursive: true, force: true });
mkdirSync('mobile-artifacts', { recursive: true });

if (ios) {
  setIosDisplayName('ios', MOBILE_APP_NAME);
  // bundle id and version live in the Xcode project (Info.plist reads $(MARKETING_VERSION)/$(CURRENT_PROJECT_VERSION))
  const pbx = 'ios/App/App.xcodeproj/project.pbxproj';
  writeFileSync(
    pbx,
    readFileSync(pbx, 'utf8')
      .replace(/PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g, `PRODUCT_BUNDLE_IDENTIFIER = "${MOBILE_APP_ID}";`)
      .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${TOTALUM_VERSION_NAME};`)
      .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${TOTALUM_VERSION_CODE};`),
  );
  if (MOBILE_ARTIFACT === 'ipa') process.exit(0);
  const derived = 'ios/build';
  run('xcodebuild', [
    ...['-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Debug'],
    ...['-sdk', 'iphonesimulator', '-derivedDataPath', derived, 'CODE_SIGNING_ALLOWED=NO', 'build'],
  ]);
  const products = join(derived, 'Build/Products/Debug-iphonesimulator');
  const app = readdirSync(products).find((f) => f.endsWith('.app'));
  if (!app) throw new Error(`no .app in ${products}`);
  // the zip's root is `<Name>.app/` (ditto --keepParent), which is what PGM verifies
  run('ditto', [
    '-c',
    '-k',
    '--keepParent',
    join(products, app),
    `mobile-artifacts/${app.replace(/\.app$/, '')}-simulator.zip`,
  ]);
  console.log(`mobile-artifacts/${app.replace(/\.app$/, '')}-simulator.zip`);
} else {
  setAndroidIdentity('android', MOBILE_APP_ID, MOBILE_APP_NAME);
  const task = TASKS[MOBILE_ARTIFACT];
  run('./gradlew', [task[0], '--no-daemon', '--console=plain'], 'android');
  const outDir = join('android', task[1]);
  const file = readdirSync(outDir).find((f) => f.endsWith('.apk') || f.endsWith('.aab'));
  if (!file) throw new Error(`no artefact in ${outDir}`);
  copyFileSync(join(outDir, file), join('mobile-artifacts', file));
  console.log(`mobile-artifacts/${file}`);
}
