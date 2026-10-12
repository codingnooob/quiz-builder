// The ONE list of mobile-only paths (A7.15, plan 06 §14.0; the same frozen list as totalum-contracts
// `MOBILE_EXCLUDED_PATHS`). They are never inputs of the web build, never in the tree hash, never preview assets.
export const MOBILE_EXCLUDED_PATHS = [
  'android/**',
  'ios/**',
  'capacitor.config.ts',
  'capacitor.config.*.ts',
  'mobile/**',
  'store/**',
  'out/**',
  '.next-mobile/**',
  'mobile-artifacts/**',
];

/**
 * A7.10 amendment 2026-09-28: mobile builds never run on the Sprite, always on Codemagic (which sets `CM_BUILD_ID`);
 * the only mobile step on the Sprite is AM's signing kit. `mobile:setup` and `build:mobile` stop here elsewhere.
 */
export function onlyOnCodemagic(env = process.env) {
  if (env.CM_BUILD_ID) return;
  console.error(
    'Mobile builds run on Codemagic, never here: the user presses Build in the Mobile tab. `npm run mobile:logs` shows why the last one failed.',
  );
  process.exit(1);
}
