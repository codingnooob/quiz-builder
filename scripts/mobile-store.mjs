// `npm run mobile:store` (plan 06 §14.3, A7.10): checks the app-store folder the agent writes before the owner submits
// it in each store's console (nothing here contacts a store). Mobile-only (A7.15): never a web build input.
//   store/CHECKLIST.md                                   submission checklist (guideline 4.2 risks)
//   store/listing/<locale>/google-play.json              { title ≤ 30, shortDescription ≤ 80, fullDescription ≤ 4000 }
//   store/listing/<locale>/app-store.json                { name ≤ 30, subtitle ≤ 30, description ≤ 4000, keywords ≤ 100 }
//   store/screenshots/{phone,tablet}/<locale>/NN.png     PNG, each side 320–3840 px
//   store/ios/PrivacyInfo.xcprivacy                       a plist; store/google-play/data-safety.json JSON (both optional)
// Exit 1 with one `store/<file>: <rule>` line per problem.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const LIMITS = {
  'google-play.json': { title: 30, shortDescription: 80, fullDescription: 4000 },
  'app-store.json': { name: 30, subtitle: 30, description: 4000, keywords: 100 },
};
const PNG = '89504e470d0a1a0a';

export function checkStore(root = '.') {
  const store = join(root, 'store');
  const problems = [];
  const at = (file, rule) => problems.push(`store/${file}: ${rule}`);
  const files = existsSync(store)
    ? readdirSync(store, { recursive: true })
        .map((f) => f.split('\\').join('/'))
        .sort()
    : [];
  if (!files.includes('CHECKLIST.md')) at('CHECKLIST.md', 'missing');
  const listings = files.filter((f) => /^listing\/[^/]+\/(google-play|app-store)\.json$/.test(f));
  if (!listings.length) at('listing/<locale>/', 'no google-play.json or app-store.json');
  for (const file of listings) {
    let listing;
    try {
      listing = JSON.parse(readFileSync(join(store, file), 'utf8'));
    } catch {
      at(file, 'not valid JSON');
      continue;
    }
    for (const [key, max] of Object.entries(LIMITS[file.split('/').at(-1)])) {
      const value = listing[key];
      if (typeof value !== 'string' || !value.trim()) at(file, `${key} is required`);
      else if (value.length > max)
        at(file, `${key} is ${String(value.length)} characters (max ${String(max)})`);
    }
  }
  for (const file of files.filter((f) => f.startsWith('screenshots/') && f.endsWith('.png'))) {
    const head = readFileSync(join(store, file)).subarray(0, 24);
    if (head.length < 24 || head.subarray(0, 8).toString('hex') !== PNG) {
      at(file, 'not a PNG');
      continue;
    }
    const [w, h] = [head.readUInt32BE(16), head.readUInt32BE(20)];
    if (Math.min(w, h) < 320 || Math.max(w, h) > 3840)
      at(file, `${String(w)}×${String(h)}: each side 320–3840 px`);
  }
  if (
    files.includes('ios/PrivacyInfo.xcprivacy') &&
    !/<plist[\s>][\s\S]*<\/plist>\s*$/.test(readFileSync(join(store, 'ios/PrivacyInfo.xcprivacy'), 'utf8'))
  )
    at('ios/PrivacyInfo.xcprivacy', 'not a plist');
  if (files.includes('google-play/data-safety.json'))
    try {
      JSON.parse(readFileSync(join(store, 'google-play/data-safety.json'), 'utf8'));
    } catch {
      at('google-play/data-safety.json', 'not valid JSON');
    }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const problems = checkStore();
  for (const p of problems) console.error(p);
  if (problems.length) process.exitCode = 1;
  else console.log('mobile:store: store/ is ready to submit');
}
