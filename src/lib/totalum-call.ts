// Review 57 R4/R5: Totalum's own calls into this app — its cron jobs and PGM's post-deploy integration check — carry
// `X-Totalum-Call: v1.<exp>.<hmac>`, HMAC-SHA256 under the per-project key PGM binds as TOTALUM_CALL_KEY, over
// `v1.<exp>.<path>`. With the key bound (preview and published Workers) only a valid signature passes; the live site
// never accepts an unsigned call; the laptop (`npm run dev`) and the Sprite have no key and accept one, to test by curl.
// Platform-owned.
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

export async function isTotalumCall(req: Request, now = Date.now()): Promise<boolean> {
  const keyHex = process.env.TOTALUM_CALL_KEY;
  if (!keyHex) return process.env.TOTALUM_USAGE_ENV !== 'live';
  const [v, exp, mac] = req.headers.get('x-totalum-call')?.split('.') ?? [];
  const seconds = Number(exp) - now / 1000;
  if (v !== 'v1' || !mac || !(seconds > 0 && seconds <= 300)) return false;
  try {
    const raw = Uint8Array.from(keyHex.match(/../g) ?? [], (b) => parseInt(b, 16));
    const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const path = new URL(req.url).pathname;
    const want = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v1.${exp}.${path}`)));
    let diff = want.length ^ mac.length;
    for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ (mac.charCodeAt(i) || 0);
    return diff === 0;
  } catch {
    return false;
  }
}
