// Murmur's optional brains. Bring whichever account you already have:
// Claude (Anthropic), ChatGPT (OpenAI) or Grok (xAI). All three return the
// same JSON shape: { say, actions: [{ type, value }] }.
import { settings } from '../state.js';

// In the desktop app, Tauri's HTTP plugin skips browser CORS rules.
export const aiFetch = (...a) => (window.__TAURI__?.http?.fetch ? window.__TAURI__.http.fetch(...a) : fetch(...a));

export const PROVIDERS = {
  anthropic: { label: 'Claude (Anthropic)', keyField: 'apiKey', modelField: 'model', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], keyHint: 'sk-ant-…', listUrl: 'https://api.anthropic.com/v1/models' },
  openai: { label: 'ChatGPT (OpenAI)', keyField: 'openaiKey', modelField: 'openaiModel', models: ['gpt-6-sol', 'gpt-6-luna'], keyHint: 'sk-…', base: 'https://api.openai.com/v1' },
  xai: { label: 'Grok (xAI)', keyField: 'xaiKey', modelField: 'xaiModel', models: ['grok-4.7'], keyHint: 'xai-…', base: 'https://api.x.ai/v1' },
};

export const activeProvider = () => PROVIDERS[settings.provider] ? settings.provider : 'anthropic';
export const providerKey = (id = activeProvider()) => settings[PROVIDERS[id].keyField] || '';
export const providerModel = (id = activeProvider()) => settings[PROVIDERS[id].modelField] || PROVIDERS[id].models[0];

// Asks the provider which models this key can use.
export async function listModels(id = activeProvider()) {
  const key = providerKey(id);
  if (!key) throw new Error('Add an API key first');
  if (id === 'anthropic') {
    const r = await aiFetch('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return (await r.json()).data.map(m => m.id);
  }
  const r = await aiFetch(`${PROVIDERS[id].base}/models`, { headers: { Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  const ids = (await r.json()).data.map(m => m.id);
  return id === 'openai' ? ids.filter(x => /^(gpt|o\d|chatgpt)/.test(x)).sort().reverse() : ids.sort().reverse();
}

let anthropicSdk = null;

// messages: [{ role: 'user'|'assistant', content: string }]
export async function complete({ system, messages, schema }) {
  const id = activeProvider(), key = providerKey(id), model = providerModel(id);
  if (!key) throw new Error('No API key');

  if (id === 'anthropic') {
    if (!anthropicSdk) anthropicSdk = (await import('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.132.1/+esm')).default;
    const client = new anthropicSdk({ apiKey: key, dangerouslyAllowBrowser: true, fetch: aiFetch });
    const supportsFallback = /opus-5-5|sonnet-5-5/.test(model);
    const res = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      system,
      messages,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      ...(supportsFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
    });
    if (res.stop_reason === 'refusal') return { refused: true };
    return { text: res.content.filter(b => b.type === 'text').map(b => b.text).join('') };
  }

  // OpenAI and xAI share the Chat Completions shape.
  const r = await aiFetch(`${PROVIDERS[id].base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, ...messages],
      response_format: { type: 'json_schema', json_schema: { name: 'murmur_reply', strict: true, schema } },
    }),
  });
  if (!r.ok) {
    const body = await r.text();
    const err = new Error(`${r.status} ${body.slice(0, 300)}`);
    err.status = r.status;
    throw err;
  }
  const data = await r.json();
  const msg = data.choices?.[0]?.message;
  if (msg?.refusal) return { refused: true };
  return { text: msg?.content || '' };
}
