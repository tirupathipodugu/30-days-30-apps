// Providers: the free AI services you can connect. All of them are called straight from this page
// with your own key (each one allows browser calls), through the same OpenAI-style chat API, so one
// function talks to all of them. Keys live only in this browser's storage.

export const PROVIDERS = [
  {
    id: 'gemini', name: 'Google Gemini',
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyPage: 'https://aistudio.google.com/app/apikey',
    how: 'Sign in with Google, click "Create API key", copy it.',
    looksLike: (k) => /^AIza[\w-]{30,}$/.test(k),
  },
  {
    id: 'groq', name: 'Groq',
    base: 'https://api.groq.com/openai/v1',
    keyPage: 'https://console.groq.com/keys',
    how: 'Sign in, click "Create API Key", copy it.',
    looksLike: (k) => /^gsk_\w{20,}$/.test(k),
  },
  {
    id: 'openrouter', name: 'OpenRouter (free models)',
    base: 'https://openrouter.ai/api/v1',
    keyPage: 'https://openrouter.ai/settings/keys',
    how: 'Easiest: press Connect and approve. Or create a key and paste it.',
    looksLike: (k) => /^sk-or-[\w-]{20,}$/.test(k),
    oauth: true,
  },
  {
    id: 'cerebras', name: 'Cerebras',
    base: 'https://api.cerebras.ai/v1',
    keyPage: 'https://cloud.cerebras.ai/',
    how: 'Sign in, open API Keys, create one, copy it.',
    looksLike: (k) => /^csk-\w{20,}$/.test(k),
  },
  {
    id: 'mistral', name: 'Mistral',
    base: 'https://api.mistral.ai/v1',
    keyPage: 'https://console.mistral.ai/api-keys',
    how: 'Sign in, choose the free Experiment plan, create a key, copy it.',
    looksLike: (k) => /^[A-Za-z0-9]{32}$/.test(k),
  },
];

export const byId = (id) => PROVIDERS.find((p) => p.id === id);

/** Which provider a pasted key belongs to, or null. */
export function detect(key) {
  const k = key.trim();
  return PROVIDERS.find((p) => p.looksLike(k)) || null;
}

// ---------- storage ----------

const KEY = (id) => `orch-key-${id}`;
export function getKey(id) { try { return localStorage.getItem(KEY(id)) || ''; } catch { return ''; } }
export function setKey(id, key) { try { key ? localStorage.setItem(KEY(id), key) : localStorage.removeItem(KEY(id)); } catch {} }
export const connected = () => PROVIDERS.filter((p) => getKey(p.id));

// ---------- models ----------

const modelCache = new Map();

/** The models this key can use. For OpenRouter, only the free ones. */
export async function listModels(p, key = getKey(p.id)) {
  if (modelCache.has(p.id)) return modelCache.get(p.id);
  const res = await fetch(`${p.base}/models`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw httpError(res.status, await res.text().catch(() => ''));
  const data = await res.json();
  let ids = (data.data || data.models || []).map((m) => (m.id || m.name || '').replace(/^models\//, '')).filter(Boolean);
  if (p.id === 'openrouter') ids = ids.filter((id) => id.endsWith(':free'));
  if (p.id === 'gemini') ids = ids.filter((id) => /gemini|gemma/.test(id) && !/embed|tts|image|audio|live|vision-only/.test(id));
  ids = ids.filter((id) => !/whisper|tts|embed|guard|moderation|audio|transcrib|speech|vision-preview/i.test(id));
  modelCache.set(p.id, ids);
  return ids;
}

export function forgetModels(id) { modelCache.delete(id); }

function httpError(status, body) {
  const e = new Error(`HTTP ${status}`);
  e.status = status;
  e.body = body.slice(0, 300);
  return e;
}

/**
 * Stream a chat answer. onText gets each new piece of text. Resolves with the full text.
 * Throws an error with .status for HTTP failures (429 = out of free quota for now).
 */
export async function chat(p, model, messages, onText, signal) {
  const res = await fetch(`${p.base}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${getKey(p.id)}`,
      'Content-Type': 'application/json',
      ...(p.id === 'openrouter' ? { 'HTTP-Referer': location.origin, 'X-Title': 'AI Orchestrator' } : {}),
    },
    body: JSON.stringify({ model, messages, stream: true }),
  });
  if (!res.ok) throw httpError(res.status, await res.text().catch(() => ''));
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return full;
      try {
        const j = JSON.parse(payload);
        if (j.error) throw httpError(j.error.code || 500, JSON.stringify(j.error));
        const piece = j.choices?.[0]?.delta?.content || '';
        if (piece) { full += piece; onText(piece); }
      } catch (err) {
        if (err.status) throw err;
      }
    }
  }
  return full;
}

// ---------- OpenRouter one-click connect (OAuth PKCE) ----------

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Send the browser to OpenRouter to approve; it comes back here with ?code=. */
export async function openRouterConnect() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  try { sessionStorage.setItem('orch-pkce', verifier); } catch {}
  const back = location.origin + location.pathname;
  location.href = `https://openrouter.ai/auth?callback_url=${encodeURIComponent(back)}&code_challenge=${challenge}&code_challenge_method=S256`;
}

/** On return from OpenRouter, swap the code for a key. Returns true if a key was saved. */
export async function openRouterFinish() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (!code) return false;
  history.replaceState(null, '', location.pathname);
  let verifier = '';
  try { verifier = sessionStorage.getItem('orch-pkce') || ''; sessionStorage.removeItem('orch-pkce'); } catch {}
  const res = await fetch('https://openrouter.ai/api/v1/auth/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
  });
  if (!res.ok) throw new Error('OpenRouter did not return a key');
  const { key } = await res.json();
  if (!key) return false;
  setKey('openrouter', key);
  return true;
}
