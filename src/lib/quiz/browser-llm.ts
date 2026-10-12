// Writing questions with a model that runs on the visitor's own device (WebGPU), through the open-source WebLLM
// library. Browser-only. The library is loaded from a CDN when needed, so it never weighs on the rest of the site;
// the model files are downloaded once and kept by the browser.
import { extractJson, QUESTIONS_JSON_SCHEMA, questionPrompt } from './prompt';
import type { Difficulty } from './types';

const WEBLLM_URL = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/+esm';

export type LocalModel = { id: string; label: string; size: string; blurb: string };

export const LOCAL_MODELS: LocalModel[] = [
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Small', size: '≈1 GB download', blurb: 'Fastest, runs on most laptops; the simplest questions and the weakest translations.' },
  { id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', label: 'Balanced', size: '≈2 GB download', blurb: 'A good middle: noticeably better questions, needs a decent graphics chip.' },
  { id: 'Qwen2.5-7B-Instruct-q4f16_1-MLC', label: 'Best quality', size: '≈5 GB download', blurb: 'The best an on-device model can do here; slow, and needs a strong GPU with about 6 GB of video memory.' },
];

export type DeviceInfo = { webgpu: boolean; suggested: string; reason: string };

/** Whether this browser can run a model, and which size to suggest from what the device reports. */
export async function detectDevice(): Promise<DeviceInfo> {
  const [small, balanced, best] = LOCAL_MODELS.map((m) => m.id) as [string, string, string];
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ limits: { maxBufferSize: number } } | null> } }).gpu;
  if (!gpu) return { webgpu: false, suggested: small, reason: 'This browser has no WebGPU. Use a recent desktop Chrome or Edge.' };
  let adapter: Awaited<ReturnType<typeof gpu.requestAdapter>> = null;
  try {
    adapter = await gpu.requestAdapter();
  } catch {
    adapter = null;
  }
  if (!adapter) return { webgpu: false, suggested: small, reason: 'No graphics chip is available to this browser for running a model.' };
  const buffer = adapter.limits.maxBufferSize;
  const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;
  const mobile = /android|iphone|ipad|mobile/i.test(navigator.userAgent);
  if (mobile || memory <= 4 || buffer < 2 ** 31) return { webgpu: true, suggested: small, reason: 'Suggested for this device: the small model.' };
  if (buffer >= 2 ** 32 && memory >= 8) return { webgpu: true, suggested: best, reason: 'Your device looks powerful enough for the best-quality model; the balanced one is quicker.' };
  return { webgpu: true, suggested: balanced, reason: 'Suggested for this device: the balanced model.' };
}

type Chat = {
  chat: { completions: { create(req: object): Promise<{ choices: { message: { content: string | null } }[] }> } };
  unload(): Promise<void>;
};
export type LocalEngine = Chat;

/** Downloads (first time only) and starts the model; `onProgress` gets a short status line. */
export async function loadEngine(modelId: string, onProgress: (text: string) => void): Promise<LocalEngine> {
  const url: string = WEBLLM_URL;
  const webllm = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)) as {
    CreateMLCEngine(id: string, config: { initProgressCallback: (r: { progress: number; text: string }) => void }): Promise<Chat>;
  };
  return webllm.CreateMLCEngine(modelId, {
    initProgressCallback: (r) => onProgress(r.text.length > 90 ? `${r.text.slice(0, 90)}…` : r.text || `${Math.round(r.progress * 100)}%`),
  });
}

export type Material = { title: string; content: string; count: number; difficulty: Difficulty; languages: string[] };
export type RawQuestions = { questions: unknown[] };

// A small model has a short memory: a call gets a window of the chapter and writes a few question texts.
const WINDOW_CHARS = 4500;
const UNITS_PER_CALL = 6; // questions × languages

/** Writes one chapter's questions, a few at a time; calls that fail to give valid JSON are skipped. */
export async function writeChapter(engine: LocalEngine, m: Material, onStep: (done: number, total: number) => void, signal?: { stopped: boolean }): Promise<RawQuestions> {
  const text = m.content.slice(0, 60_000);
  const perCall = Math.max(1, Math.floor(UNITS_PER_CALL / m.languages.length));
  const calls = Math.ceil(m.count / perCall);
  const base = Math.floor(m.count / calls);
  const extra = m.count % calls;
  const slice = text.length / calls;
  const questions: unknown[] = [];
  onStep(0, calls);
  for (let k = 0; k < calls; k++) {
    if (signal?.stopped) break;
    const start = Math.max(0, Math.floor(k * slice) - 200);
    const prompt = questionPrompt({
      title: m.title,
      content: slice < 1200 ? text.slice(0, WINDOW_CHARS * 2) : text.slice(start, start + WINDOW_CHARS),
      count: base + (k < extra ? 1 : 0),
      difficulty: m.difficulty,
      languages: m.languages,
      part: calls > 1 ? { k, n: calls } : undefined,
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const reply = await engine.chat.completions.create({
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.4,
          max_tokens: 2000,
          response_format: { type: 'json_object', schema: JSON.stringify(QUESTIONS_JSON_SCHEMA) },
        });
        const json = extractJson(reply.choices[0]?.message.content ?? '') as { questions?: unknown[] };
        if (Array.isArray(json.questions) && json.questions.length > 0) {
          questions.push(...json.questions);
          break;
        }
      } catch (err) {
        console.error('on-device call failed', err);
      }
    }
    onStep(k + 1, calls);
  }
  return { questions };
}
