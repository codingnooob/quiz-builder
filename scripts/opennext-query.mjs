import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// OpenNext 4.1 (`@opennextjs/aws`, bundled by `opennextjs-cloudflare build`) hands Next.js the request URL rebuilt
// from the decoded query without encoding it again (`req.url = pathname + convertToQueryString(query)`, kept for
// Next ≥ 15.4). So `?q=C%2B%2B` reached the app as `?q=C++` and `searchParams.get('q')` was `'C  '`; a `%26`, `%3D`,
// `%23` or `%25` in a value split or broke it the same way. Encode each key and value there, as a URL needs.
// Idempotent; a release that already encodes (or reshapes the function) is left as it is.
const PLAIN = ['`${key}=${entry}`', '`${key}=${value}`'];
const ENCODED = [
  '`${encodeURIComponent(key)}=${encodeURIComponent(entry)}`',
  '`${encodeURIComponent(key)}=${encodeURIComponent(value)}`',
];

/** Rewrites OpenNext's `convertToQueryString` in `file` (default: the installed one) to encode; true if it changed. */
export function encodeOpenNextQuery(
  file = createRequire(import.meta.url).resolve('@opennextjs/aws/core/routing/util.js'),
) {
  const code = readFileSync(file, 'utf8');
  const fixed = PLAIN.reduce((c, plain, i) => c.replaceAll(plain, ENCODED[i]), code);
  if (fixed === code) return false;
  writeFileSync(file, fixed);
  return true;
}
