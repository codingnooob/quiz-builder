'use client';

import { useEffect } from 'react';

import { input } from '@/components/ui';
import { detectDevice, LOCAL_MODELS, type DeviceInfo } from '@/lib/quiz/browser-llm';
import { PROVIDERS } from '@/lib/quiz/providers';

export type AiSource = {
  kind: 'builtin' | 'key' | 'device';
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  localModel: string;
};

export const defaultAiSource: AiSource = { kind: 'builtin', provider: 'openai', apiKey: '', baseUrl: PROVIDERS[0]!.baseUrl, model: PROVIDERS[0]!.model, localModel: LOCAL_MODELS[0]!.id };

const OPTION = 'flex cursor-pointer items-start gap-3 rounded-xl border border-stone-300 bg-white p-3.5 transition-colors has-[:checked]:border-brand has-[:checked]:bg-brand/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/40';

export function AiSourcePicker({ value, onChange, device, onDevice }: { value: AiSource; onChange: (v: AiSource) => void; device: DeviceInfo | null; onDevice: (d: DeviceInfo) => void }) {
  const set = (patch: Partial<AiSource>) => onChange({ ...value, ...patch });
  const provider = PROVIDERS.find((p) => p.id === value.provider) ?? PROVIDERS[0]!;

  useEffect(() => {
    if (device) return;
    void detectDevice().then((d) => {
      onDevice(d);
      onChange({ ...value, localModel: d.suggested });
    });
    // run once: the detection result seeds the suggested model
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid gap-3">
      <label className={OPTION}>
        <input type="radio" name="aiSource" className="mt-1 accent-[var(--color-brand)]" checked={value.kind === 'builtin'} onChange={() => set({ kind: 'builtin' })} />
        <span>
          <span className="block text-sm font-semibold">Built-in AI <span className="ms-1 rounded-full bg-accent/60 px-2 py-0.5 text-xs font-medium text-brand">Recommended</span></span>
          <span className="mt-0.5 block text-sm text-stone-600">The fastest option and the most accurate questions, in every language. Nothing to set up.</span>
        </span>
      </label>

      <label className={OPTION}>
        <input type="radio" name="aiSource" className="mt-1 accent-[var(--color-brand)]" checked={value.kind === 'key'} onChange={() => set({ kind: 'key' })} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Use your own AI key</span>
          <span className="mt-0.5 block text-sm text-stone-600">Questions are written by your own account with a provider, so you pay them directly and there is no waiting between requests. Pick a strong model for the best quality.</span>
        </span>
      </label>
      {value.kind === 'key' && (
        <div className="grid gap-3 rounded-xl border border-stone-200 bg-stone-50 p-4 sm:grid-cols-2" data-testid="own-key-fields">
          <label className="text-sm font-medium">
            Provider
            <select
              className={`${input} bg-white`}
              value={value.provider}
              onChange={(e) => {
                const p = PROVIDERS.find((x) => x.id === e.target.value)!;
                set({ provider: p.id, baseUrl: p.baseUrl, model: p.model });
              }}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            Model
            <input className={input} value={value.model} onChange={(e) => set({ model: e.target.value })} placeholder="Model name" spellCheck={false} autoComplete="off" />
          </label>
          {provider.id === 'custom' && (
            <label className="text-sm font-medium sm:col-span-2">
              Provider address
              <input className={input} value={value.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://api.example.com/v1" spellCheck={false} autoComplete="off" />
            </label>
          )}
          <label className="text-sm font-medium sm:col-span-2">
            API key
            <input type="password" className={input} value={value.apiKey} onChange={(e) => set({ apiKey: e.target.value })} placeholder={provider.keyHint} spellCheck={false} autoComplete="off" name="ai-api-key" />
          </label>
          <p className="text-xs text-stone-600 sm:col-span-2">
            Your key is kept only in this browser tab and sent with each request to write questions. It is used for that request and never saved or logged on this site, and it goes nowhere except the provider you chose. Your document text is sent to that provider under its terms.
          </p>
        </div>
      )}

      <label className={`${OPTION} ${device && !device.webgpu ? 'cursor-not-allowed opacity-60' : ''}`}>
        <input type="radio" name="aiSource" className="mt-1 accent-[var(--color-brand)]" checked={value.kind === 'device'} disabled={!!device && !device.webgpu} onChange={() => set({ kind: 'device' })} />
        <span>
          <span className="block text-sm font-semibold">On this device <span className="ms-1 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700">Private, experimental</span></span>
          <span className="mt-0.5 block text-sm text-stone-600">A small AI model runs inside your browser, so the chapter text is not sent to any AI provider when the questions are written.</span>
          {device && !device.webgpu && <span className="mt-1 block text-sm text-amber-800">{device.reason}</span>}
        </span>
      </label>
      {value.kind === 'device' && device?.webgpu && (
        <div className="grid gap-3 rounded-xl border border-stone-200 bg-stone-50 p-4" data-testid="device-fields">
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <strong>The trade-off for privacy is quality.</strong> Models small enough to run on a laptop write simpler and less reliable questions than the built-in AI, are noticeably weaker in languages other than English, and are slow: a few chapters can take several minutes. Expect to skim the questions before you use them.
          </p>
          <fieldset>
            <legend className="text-sm font-semibold">Model size</legend>
            <div className="mt-2 grid gap-2">
              {LOCAL_MODELS.map((m) => (
                <label key={m.id} className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm transition-colors has-[:checked]:border-brand has-[:checked]:bg-brand/5">
                  <input type="radio" name="localModel" className="mt-1 accent-[var(--color-brand)]" checked={value.localModel === m.id} onChange={() => set({ localModel: m.id })} />
                  <span>
                    <span className="font-medium">{m.label}</span> <span className="text-stone-600">· {m.size}{m.id === device.suggested ? ' · suggested for you' : ''}</span>
                    <span className="block text-stone-600">{m.blurb}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-stone-600">{device.reason}</p>
          </fieldset>
          <p className="text-xs text-stone-600">
            The first time, the model is downloaded to your browser (then kept for next time), so start on Wi-Fi and keep this tab open and in front while it works. Your document is still uploaded and split into chapters when you create the quiz; only the question writing happens on your device.
          </p>
        </div>
      )}
    </div>
  );
}
