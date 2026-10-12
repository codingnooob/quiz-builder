// Where a visitor's own AI key can be used. All of them speak the same chat API, so one code path serves every provider.
export type Provider = { id: string; label: string; baseUrl: string; model: string; keyHint: string };

export const PROVIDERS: Provider[] = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', keyHint: 'sk-…' },
  { id: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-haiku-5-5', keyHint: 'sk-ant-…' },
  { id: 'google', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', keyHint: 'AIza…' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', keyHint: 'sk-or-…' },
  { id: 'custom', label: 'Other (OpenAI-compatible)', baseUrl: '', model: '', keyHint: 'API key' },
];
