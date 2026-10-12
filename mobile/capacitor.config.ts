// MOBILE-ONLY (A7.15): the web build never reads this file. Plan 06 §14: the native app loads the published site.
// MOBILE_MODE `remote` (Android default): the WebView opens CAP_REMOTE_URL directly. `hybrid` (iOS default): the
// bundled shell in mobile/shell/dist shows a splash, then navigates to CAP_REMOTE_URL (offline page when offline).
const remote = process.env.CAP_REMOTE_URL;
const hybrid = process.env.MOBILE_MODE === 'hybrid';

// A plain object (Capacitor's `CapacitorConfig`): no type import, so a web-only project, which has no Capacitor
// installed, still type-checks.
const config = {
  appId: process.env.MOBILE_APP_ID ?? 'com.totalum.app',
  appName: process.env.MOBILE_APP_NAME ?? 'App',
  webDir: 'mobile/shell/dist',
  ...(remote
    ? { server: { ...(hybrid ? {} : { url: remote }), allowNavigation: [new URL(remote).host] } }
    : {}),
};

export default config;
