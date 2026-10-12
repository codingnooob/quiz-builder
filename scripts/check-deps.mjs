// `npm run check` (B2-PJ4): the dependency tree must be one `npm ci` accepts — the published site's build and every
// Android/iOS build install from the lock with `npm ci`. An `npm install` that let a peer conflict through (a package
// pinned below the version another one needs) passed on the Sprite and then failed every app build. Platform-owned.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** The tree's problems `npm ci` refuses (a missing or invalid package); an extraneous one is only left over. */
export function checkDeps(root = '.') {
  const r = spawnSync('npm', ['ls', '--all', '--json'], { cwd: root, encoding: 'utf8' });
  if (r.status === 0) return [];
  let problems;
  try {
    problems = JSON.parse(r.stdout).problems ?? [];
  } catch {
    problems = [r.stderr.trim() || 'npm ls failed'];
  }
  return problems.filter((p) => !p.startsWith('extraneous'));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const problems = checkDeps();
  if (problems.length) {
    console.error(
      `DEPENDENCY_CONFLICT  package.json / package-lock.json\n  ${problems.slice(0, 10).join('\n  ')}\n` +
        '  `npm ci` (the published build and every app build) refuses this tree. Use versions that agree: ' +
        '`npm view <package>@<version> peerDependencies engines`, then `npm install --save-exact <package>@<version>` ' +
        '(or another package). Never --force, --legacy-peer-deps or --engine-strict=false.',
    );
    process.exitCode = 1;
  }
}
