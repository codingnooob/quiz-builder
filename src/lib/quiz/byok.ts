// A visitor's own AI key: it arrives in request headers, is used for the calls of that one request and is never
// stored, logged or sent anywhere except the provider's address the visitor chose.
import { extractJson } from './prompt';

export type ByokConfig = { apiKey: string; baseUrl: string; model: string };

export class ByokError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const PRIVATE_HOST = /^(localhost|.*\.(local|localdomain|internal|lan|home|corp))$/i;

/** The key, address and model from the request's headers: `null` when none was sent (use the built-in AI). */
export function readByok(req: Request): ByokConfig | null {
  const apiKey = req.headers.get('x-ai-key')?.trim();
  if (!apiKey) return null;
  if (apiKey.length < 8 || apiKey.length > 400 || /\s/.test(apiKey)) throw new ByokError(400, 'That API key does not look right. Check it and try again.');

  let url: URL;
  try {
    url = new URL((req.headers.get('x-ai-base-url') ?? '').trim());
  } catch {
    throw new ByokError(400, 'The provider address is not a valid web address.');
  }
  const host = url.hostname;
  const isIp = /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[');
  if (url.protocol !== 'https:' || url.username || url.password || isIp || PRIVATE_HOST.test(host) || !host.includes('.'))
    throw new ByokError(400, 'The provider address must be a public https:// address.');

  const model = (req.headers.get('x-ai-model') ?? '').trim();
  if (!/^[\w.:/@+-]{1,100}$/.test(model)) throw new ByokError(400, 'Enter the model name your provider uses.');
  return { apiKey, baseUrl: url.origin + url.pathname.replace(/\/+$/, ''), model };
}

/** One chat call to the visitor's provider; the answer's text. */
export async function chatWithOwnKey(cfg: ByokConfig, prompt: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(100_000),
      headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: prompt }] }),
    });
  } catch {
    throw new ByokError(502, 'Could not reach your AI provider. Check the provider address and try again.');
  }
  if (!res.ok) {
    console.error('own-key provider answered', new URL(cfg.baseUrl).hostname, res.status);
    if (res.status === 401 || res.status === 403) throw new ByokError(401, 'Your AI provider rejected the API key. Check that it is correct and active.');
    if (res.status === 404) throw new ByokError(400, 'Your AI provider does not know that model name. Check the model name.');
    if (res.status === 429) throw new ByokError(429, 'Your AI provider says the rate limit or quota was reached. Wait a little, or check your plan.');
    if (res.status === 400 || res.status === 422) throw new ByokError(400, 'Your AI provider refused the request. Check the model name.');
    throw new ByokError(502, 'Your AI provider had a problem. Please try again.');
  }
  const json = (await res.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[] } | null;
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new ByokError(502, 'Your AI provider returned an empty answer. Please try again.');
  return content;
}

/** Chat call that must come back as JSON; asks once more when the first answer is not valid JSON. */
export async function jsonWithOwnKey(cfg: ByokConfig, prompt: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      return extractJson(await chatWithOwnKey(cfg, prompt));
    } catch (err) {
      if (err instanceof ByokError || attempt >= 1) throw err;
    }
  }
}
