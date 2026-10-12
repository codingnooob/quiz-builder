// The browser half of Totalum's captcha (server: src/lib/captcha.ts), loaded only by the auth form. Platform-owned;
// never edit. `null` from getChallenge = no captcha here (preview, `npm run dev`, `site.captcha = false`).
export type Challenge = { challenge: string; difficulty: number; at: number };

export async function getChallenge(): Promise<Challenge | null> {
  const res = await fetch('/api/captcha', { cache: 'no-store' }).catch(() => null);
  if (res?.status === 404) return null;
  const body: Omit<Challenge, 'at'> = res?.ok ? await res.json() : { challenge: '', difficulty: 0 };
  return { ...body, at: Date.now() };
}

/**
 * The proof-of-work solver: SHA-256 of one ≤ 55-byte ASCII block with its leading zero bits counted (the constants are
 * the fractional parts of the primes' square and cube roots). Self-contained, so it runs as a Web Worker's source
 * (`solve` below) and keeps the page responsive; returns `zeros` for tests.
 */
export function powSolver(scope: { onmessage: unknown; postMessage: (n: number) => void }) {
  const K: number[] = [];
  const H: number[] = [];
  const W = new Int32Array(64);
  for (let p = 2, n = 0; n < 64; p++) {
    let prime = true;
    for (let d = 2; d * d <= p; d++) if (p % d === 0) prime = false;
    if (!prime) continue;
    if (n < 8) H[n] = (p ** 0.5 * 2 ** 32) | 0;
    K[n++] = (p ** (1 / 3) * 2 ** 32) | 0;
  }
  const r = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  const zeros = (s: string) => {
    W.fill(0);
    for (let i = 0; i < s.length; i++) W[i >> 2] |= s.charCodeAt(i) << (24 - 8 * (i & 3));
    W[s.length >> 2] |= 128 << (24 - 8 * (s.length & 3));
    W[15] = s.length * 8;
    for (let i = 16; i < 64; i++) {
      const x = W[i - 15];
      const y = W[i - 2];
      W[i] =
        (W[i - 16] + (r(x, 7) ^ r(x, 18) ^ (x >>> 3)) + W[i - 7] + (r(y, 17) ^ r(y, 19) ^ (y >>> 10))) | 0;
    }
    let a = H[0],
      b = H[1],
      c = H[2],
      d = H[3],
      e = H[4],
      f = H[5],
      g = H[6],
      h = H[7];
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
      const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    const top = (H[0] + a) | 0;
    return top ? Math.clz32(top) : 32 + Math.clz32((H[1] + b) | 0);
  };
  scope.onmessage = (event: { data: [string, number] }) => {
    const [prefix, difficulty] = event.data;
    let n = 0;
    while (zeros(prefix + String(n)) < difficulty) n++;
    scope.postMessage(n);
  };
  return zeros;
}

function solve(challenge: string, difficulty: number): Promise<number> {
  const url = URL.createObjectURL(new Blob([`(${String(powSolver)})(self)`], { type: 'text/javascript' }));
  const worker = new Worker(url);
  return new Promise((resolve) => {
    worker.onmessage = (e: MessageEvent<number>) => {
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(e.data);
    };
    worker.postMessage([`${challenge.split('.')[1] ?? ''}:`, difficulty]);
  });
}

/** The `x-totalum-captcha` header for one submit: waits out the 2 s minimum fill time, or solves the proof of work. */
export async function captchaHeaders(c: Challenge, honeypot: string): Promise<Record<string, string>> {
  const wait = 2100 - (Date.now() - c.at);
  if (!c.difficulty && wait > 0) await new Promise((r) => setTimeout(r, wait));
  const n = c.difficulty ? await solve(c.challenge, c.difficulty) : 0;
  const s =
    (navigator.webdriver ? 1 : 0) |
    (/headless/i.test(navigator.userAgent) ? 2 : 0) |
    (navigator.languages.length ? 0 : 4);
  return { 'x-totalum-captcha': JSON.stringify({ c: c.challenge, n, s, hp: encodeURIComponent(honeypot) }) };
}
