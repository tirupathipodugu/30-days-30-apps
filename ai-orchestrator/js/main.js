// AI Orchestrator: the chat, the "Your AIs" sheet and the loop that asks the judge, calls the chosen
// model and falls back to the next one when a model hits its free limit.

import { PROVIDERS, byId, detect, getKey, setKey, connected, listModels, forgetModels, chat, openRouterConnect, openRouterFinish } from './providers.js';
import { KINDS, decideKind, candidates, pickModel } from './judge.js';
import { countAnswer, rest, restingFor, countToday } from './usage.js';

const $ = (id) => document.getElementById(id);
const history = [];      // the conversation sent to the models: { role, content }
let busy = false;

// ---------- rendering ----------

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** A small, safe Markdown renderer: code blocks, inline code, bold, italics, lists, paragraphs. */
function markdown(src) {
  const parts = src.split(/```/);
  let html = '';
  parts.forEach((part, i) => {
    if (i % 2) {
      const body = part.replace(/^[\w+-]*\n/, '');
      html += `<pre><code>${esc(body.replace(/\n$/, ''))}</code></pre>`;
      return;
    }
    const blocks = part.split(/\n{2,}/);
    for (const block of blocks) {
      const b = block.trim();
      if (!b) continue;
      const lines = b.split('\n');
      const inline = (t) => esc(t)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        .replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, '$1<i>$2</i>')
        .replace(/^#{1,6}\s*(.+)$/, '<b>$1</b>');
      if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
        html += `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>`).join('')}</ul>`;
      } else if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
        html += `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
      } else {
        html += `<p>${lines.map(inline).join('<br>')}</p>`;
      }
    }
  });
  return html;
}

function addMessage(role) {
  $('welcome')?.remove();
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.innerHTML = role === 'ai' ? '<div class="why"></div><div class="bubble"><span class="thinking">Deciding who should answer</span></div>' : '<div class="bubble"></div>';
  $('chat').append(el);
  el.scrollIntoView({ block: 'end' });
  return el;
}

function setWhy(el, parts) {
  el.querySelector('.why').innerHTML = parts.map((p) => (p.note ? `<span class="note">${esc(p.text)}</span>` : `<span class="tag">${esc(p.text)}</span>`)).join('');
}

// ---------- asking ----------

/** One quick non-streamed call on the fastest connected model, for the judge. */
async function askFast(prompt) {
  for (const id of ['groq', 'cerebras', 'gemini']) {
    const p = byId(id);
    if (!getKey(id) || restingFor(id)) continue;
    const models = await listModels(p);
    const model = pickModel('quick', models);
    if (!model) continue;
    return chat(p, model, [{ role: 'user', content: prompt }], () => {});
  }
  throw new Error('no fast model');
}

async function ask(text) {
  if (busy || !text.trim()) return;
  if (!connected().length) { openKeys(); return; }
  busy = true;
  $('send').disabled = true;
  const you = addMessage('you');
  you.querySelector('.bubble').textContent = text;
  history.push({ role: 'user', content: text });
  const ai = addMessage('ai');
  const bubble = ai.querySelector('.bubble');

  ai.querySelector('.bubble').innerHTML = `<span class="thinking">${getKey('openrouter') ? 'Jev is deciding who should answer' : 'Deciding who should answer'}</span>`;
  const decision = await decideKind(text, connected().some((p) => ['groq', 'cerebras', 'gemini'].includes(p.id)) ? askFast : null, getKey('openrouter'));
  const { list, skipped } = await candidates(decision.kind);
  const notes = [...(decision.jevNote ? [decision.jevNote] : []), ...skipped];
  const judgeTag = decision.by === 'jev'
    ? `Jev: ${KINDS[decision.kind]}${decision.confidence != null ? ` · ${Math.round(decision.confidence * 100)}% sure` : ''}`
    : KINDS[decision.kind];
  let answered = false;

  for (const { provider, model } of list) {
    setWhy(ai, [{ text: judgeTag }, { text: `→ ${provider.name.replace(/ \(.*\)/, '')} · ${model}` }, ...notes.map((n) => ({ text: n, note: true }))]);
    bubble.innerHTML = '<span class="thinking">Thinking</span>';
    let full = '';
    try {
      full = await chat(provider, model, history.slice(-12), (piece) => {
        full += piece;
        bubble.innerHTML = markdown(full);
        ai.scrollIntoView({ block: 'end' });
      });
      if (!full.trim()) throw Object.assign(new Error('empty answer'), { status: 'empty' });
      bubble.innerHTML = markdown(full);
      history.push({ role: 'assistant', content: full });
      countAnswer(provider.id);
      answered = true;
      break;
    } catch (err) {
      if (err.status === 429) {
        const retry = Number((err.body.match(/retry[^\d]{0,20}(\d+)/i) || [])[1]) || 0;
        rest(provider.id, retry);
        notes.push(`${provider.name.replace(/ \(.*\)/, '')} hit its free limit, switching`);
      } else if (err.status === 401 || err.status === 403) {
        notes.push(`${provider.name} rejected the key`);
      } else {
        notes.push(`${provider.name.replace(/ \(.*\)/, '')} failed (${err.status || 'network'}), switching`);
      }
    }
  }
  if (!answered) {
    setWhy(ai, [{ text: judgeTag }, ...notes.map((n) => ({ text: n, note: true }))]);
    bubble.innerHTML = '<p class="err">None of your connected AIs could answer right now. They may all be at their free limits. Try again in a few minutes, or connect another one in "Your AIs".</p>';
  }
  renderProviders();
  busy = false;
  $('send').disabled = false;
  $('input').focus();
}

// ---------- your AIs ----------

function openKeys() {
  renderProviders();
  $('keys').showModal();
}

function renderProviders() {
  $('key-count').textContent = connected().length;
  $('providers').innerHTML = '';
  for (const p of PROVIDERS) {
    const on = Boolean(getKey(p.id));
    const resting = restingFor(p.id);
    const el = document.createElement('div');
    el.className = 'prov';
    const state = !on ? 'Not connected' : resting ? `Resting ${resting} min after a limit` : `Connected · ${countToday(p.id)} answers today`;
    el.innerHTML = `
      <div><b>${esc(p.name)}</b><div class="state ${!on ? '' : resting ? 'rest' : 'on'}">${esc(state)}</div></div>
      <div class="acts"></div>
      <div class="how">${esc(p.how)}</div>`;
    const acts = el.querySelector('.acts');
    if (on) {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.textContent = 'Remove';
      rm.addEventListener('click', () => { setKey(p.id, ''); forgetModels(p.id); renderProviders(); });
      acts.append(rm);
    } else {
      if (p.oauth) {
        const c = document.createElement('button');
        c.type = 'button';
        c.className = 'go';
        c.textContent = 'Connect';
        c.addEventListener('click', () => openRouterConnect());
        acts.append(c);
      }
      const a = document.createElement('a');
      a.href = p.keyPage;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Get key';
      acts.append(a);
    }
    $('providers').append(el);
  }
}

async function addKey() {
  const key = $('paste').value.trim();
  const st = $('paste-status');
  st.className = 'status';
  if (!key) return;
  const p = detect(key);
  if (!p) { st.textContent = "That doesn't look like a key from these services."; st.classList.add('bad'); return; }
  st.textContent = `Looks like ${p.name}. Testing…`;
  $('add-key').disabled = true;
  try {
    forgetModels(p.id);
    const models = await listModels(p, key);
    setKey(p.id, key);
    $('paste').value = '';
    st.textContent = `✓ ${p.name} connected, ${models.length} models available.`;
    st.classList.add('good');
  } catch (err) {
    st.textContent = err.status === 401 || err.status === 403 ? `${p.name} says this key isn't valid.` : `Couldn't reach ${p.name} (${err.status || 'network'}). Check your connection and try again.`;
    st.classList.add('bad');
  }
  $('add-key').disabled = false;
  renderProviders();
}

// ---------- wiring ----------

$('open-keys').addEventListener('click', openKeys);
$('start-connect')?.addEventListener('click', openKeys);
$('close-keys').addEventListener('click', () => $('keys').close());
$('add-key').addEventListener('click', addKey);
$('paste').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addKey(); } });

$('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('input').value;
  $('input').value = '';
  $('input').style.height = '';
  ask(text);
});
$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('composer').requestSubmit(); }
});
$('input').addEventListener('input', (e) => {
  e.target.style.height = '';
  e.target.style.height = `${e.target.scrollHeight}px`;
});
for (const b of document.querySelectorAll('#examples button')) {
  b.addEventListener('click', () => { $('input').value = b.textContent; $('composer').requestSubmit(); });
}

// Coming back from OpenRouter's Connect page with a code.
openRouterFinish().then((ok) => {
  if (ok) { openKeys(); $('paste-status').textContent = '✓ OpenRouter connected.'; $('paste-status').className = 'status good'; }
}).catch(() => {
  openKeys();
  $('paste-status').textContent = "OpenRouter didn't finish connecting. Try again, or paste a key.";
  $('paste-status').className = 'status bad';
});
renderProviders();
