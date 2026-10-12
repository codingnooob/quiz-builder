// Plan 06 §10.1 (A7.8): PGM's thumbnail capture loads the preview with `X-Totalum-Screenshot: v1.<projectId>.<exp>.<hmac>`
// (HMAC-SHA256 under the per-project key PGM binds to the preview Worker only). A valid token hides the development
// banner and grants nothing else. No key (published site, laptop, Sprite) → never valid. Platform-owned.
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

export async function verifyScreenshotToken(
  token: string | null,
  projectId = process.env.TOTALUM_PROJECT_ID,
  keyHex = process.env.TOTALUM_SCREENSHOT_KEY,
  now = Date.now(),
): Promise<boolean> {
  const [v, id, exp, mac] = token?.split('.') ?? [];
  const seconds = Number(exp) - now / 1000;
  if (v !== 'v1' || !id || id !== projectId || !keyHex || !mac || !(seconds > 0 && seconds <= 300))
    return false;
  try {
    const raw = Uint8Array.from(keyHex.match(/../g) ?? [], (b) => parseInt(b, 16));
    const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const want = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v1.${id}.${exp}`)));
    let diff = want.length ^ mac.length;
    for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ (mac.charCodeAt(i) || 0);
    return diff === 0;
  } catch {
    return false;
  }
}
