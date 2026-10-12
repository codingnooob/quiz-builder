import { createOpenRouter } from '@openrouter/ai-sdk-provider';

// Plan 06 §17b (A5.19, A5.27): the only bridge between the app and a model — Totalum's AI gateway (OpenRouter's API)
// with the project key, billed in credits. Never a provider key, never a bare model string (it would go to Vercel's
// gateway). A preset (the gateway sends it as the newest model of its family), or a pinned OpenRouter id. Server-only.
export type ModelPreset = 'fast' | 'smart' | 'reasoning' | 'vision';
const baseURL = () => process.env.TOTALUM_AI_BASE_URL || 'https://ai.totalum.app/api/v1';
// SB10: in the sandbox, the deployed app's own key (as `totalum-sdk` does), so the agent's checks match the site
const apiKey = () => process.env.TOTALUM_APP_KEY || process.env.TOTALUM_PROJECT_KEY;
const gateway = () => createOpenRouter({ baseURL: baseURL(), apiKey: apiKey() });
export const model = (alias: ModelPreset | (string & {})) => gateway()(alias);
/** Image generation and editing (`generateImage` from `ai`): a preset (`image`, `image-edit`) or an image model id. */
export const imageModel = (alias: 'image' | 'image-edit' | (string & {})) => gateway().imageModel(alias);
/** Embeddings (`embed` / `embedMany` from `ai`): the `embed` preset or an embedding model id. */
export const embeddingModel = (alias: 'embed' | (string & {})) => gateway().textEmbeddingModel(alias);

/** A refused gateway call: 402 no credits, 429 too many calls or media paused this hour (`retryAfter` s), 403 off. */
export class AiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfter?: string,
  ) {
    super(message);
  }
}

/**
 * B2: OpenRouter's other endpoints on the same gateway, key and billing — `/audio/speech` (audio bytes),
 * `/audio/transcriptions`, `/videos` (a job), `/videos/{id}`, `/videos/{id}/content`, `/rerank`, `/systemone`
 * (decision models: typed answers), `/models`.
 * POST with `body` (JSON), else GET. A refusal throws `AiError`.
 */
export async function aiFetch(path: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${baseURL()}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: `Bearer ${apiKey() ?? ''}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (res.ok) return res;
  const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  throw new AiError(
    res.status,
    json?.error?.message ?? `AI call failed (${String(res.status)})`,
    res.headers.get('retry-after') ?? undefined,
  );
}
