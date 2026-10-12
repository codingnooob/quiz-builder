// `npm run mobile:enable` (A7.10 amendment 2026-09-28): a project is web-only until the user asks for a mobile app.
// This adds the pinned Capacitor packages and the shell's `capacitor.config.ts` (from `mobile/`), once; it builds
// nothing. Builds run on Codemagic from the Mobile tab, never here. Mobile-only (A7.15): never a web build input.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const CAPACITOR_VERSION = '8.5.2';
export const CAPACITOR_PACKAGES = [
  '@capacitor/cli',
  '@capacitor/core',
  '@capacitor/android',
  '@capacitor/ios',
];

/** What is missing: the packages to install (pinned) and whether the config must be written. */
export function plan(root = '.') {
  const pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'));
  const have = { ...pkg.dependencies, ...pkg.devDependencies };
  return {
    install: CAPACITOR_PACKAGES.filter((p) => !have[p]).map((p) => `${p}@${CAPACITOR_VERSION}`),
    config: !existsSync(`${root}/capacitor.config.ts`),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { install, config } = plan();
  if (install.length)
    execFileSync('npm', ['install', '--save-dev', '--save-exact', '--no-audit', '--no-fund', ...install], {
      stdio: 'inherit',
    });
  if (config) copyFileSync('mobile/capacitor.config.ts', 'capacitor.config.ts');
  console.log(
    install.length || config
      ? `mobile:enable: Capacitor ${CAPACITOR_VERSION} added. The user builds the app from the Mobile tab (Codemagic).`
      : 'mobile:enable: already enabled.',
  );
}
