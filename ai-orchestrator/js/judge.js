// The judge: decides what kind of question this is, then which connected model should answer it.
// 1. Kind of question: keyword rules first (instant, free). If they aren't sure and a fast model is
//    connected, that model is asked for one word. (Jev can take this step later.)
// 2. Who answers: for each kind, providers and models are ranked; anything resting after a limit
//    is skipped, and the next one is tried if a call fails.

import { PROVIDERS, connected, listModels } from './providers.js';
import { isResting } from './usage.js';

export const KINDS = {
  coding: 'Coding',
  quick: 'Quick fact',
  writing: 'Writing',
  math: 'Maths',
  deep: 'Deep thinking',
};

const RULES = [
  ['coding', /\b(code|coding|bug|error|exception|stack ?trace|function|class|compile|regex|sql|python|javascript|typescript|java\b|c\+\+|rust|golang|react|css|html|api|json|npm|git|docker|refactor|unit test|script)\b|```|=>|\(\)\s*{/i],
  ['math', /\b(solve|equation|integral|derivative|probability|prove|calculate|how many|percent|\d+\s*[-+*/^]\s*\d+)\b/i],
  ['writing', /\b(write|rewrite|draft|email|letter|essay|story|poem|caption|tweet|post|summari[sz]e|translate|tone|bio|cover letter|blog)\b/i],
  ['deep', /\b(why|explain|compare|pros and cons|trade-?offs?|strategy|plan|design|analy[sz]e|should i|what if|step by step|reason)\b/i],
];

/** Instant guess from keywords. Returns { kind, sure }. */
export function ruleKind(text) {
  const hits = RULES.filter(([, re]) => re.test(text)).map(([k]) => k);
  if (hits.length === 1) return { kind: hits[0], sure: true };
  if (hits.length > 1) return { kind: hits[0], sure: false };
  // Short and no keywords: probably a quick question.
  return { kind: text.split(/\s+/).length <= 12 ? 'quick' : 'deep', sure: text.split(/\s+/).length <= 12 };
}

// For each kind: which providers to try first, and which model names fit best (first match wins).
const PLAN = {
  coding: {
    providers: ['cerebras', 'groq', 'gemini', 'openrouter', 'mistral'],
    models: [/qwen.*coder/i, /codestral/i, /devstral/i, /gpt-oss-120b/i, /deepseek.*(v3|coder)/i, /gemini.*pro/i, /qwen3.*(235|480|max)/i, /gemini.*flash(?!-lite)/i, /llama.*(70b|405b)/i, /gpt-oss/i, /large/i],
  },
  quick: {
    providers: ['groq', 'cerebras', 'gemini', 'mistral', 'openrouter'],
    models: [/llama.*(8b|instant)/i, /flash-lite/i, /gpt-oss-20b/i, /mistral-small/i, /gemini.*flash/i, /qwen.*(8b|14b|32b)/i, /small|mini|lite/i, /gpt-oss/i],
  },
  writing: {
    providers: ['gemini', 'mistral', 'openrouter', 'groq', 'cerebras'],
    models: [/gemini.*pro/i, /mistral-large/i, /gemini.*flash(?!-lite)/i, /llama.*(70b|405b|maverick)/i, /gpt-oss-120b/i, /qwen3/i, /medium|large/i],
  },
  math: {
    providers: ['gemini', 'cerebras', 'groq', 'openrouter', 'mistral'],
    models: [/gemini.*pro/i, /deepseek.*r1/i, /gpt-oss-120b/i, /qwen.*(thinking|qwq|235)/i, /magistral/i, /gemini.*flash(?!-lite)/i, /gpt-oss/i, /large/i],
  },
  deep: {
    providers: ['gemini', 'openrouter', 'groq', 'cerebras', 'mistral'],
    models: [/gemini.*pro/i, /deepseek.*r1/i, /gpt-oss-120b/i, /qwen.*(thinking|235|max)/i, /llama.*(405b|maverick|70b)/i, /magistral|mistral-large/i, /gemini.*flash(?!-lite)/i, /large|pro/i],
  },
};

/** Pick the best model id this provider has for a kind, or the first chat model it has. */
export function pickModel(kind, models) {
  for (const re of PLAN[kind].models) {
    const m = models.find((id) => re.test(id) && !/preview-\d{2}-\d{2}$/.test(id));
    if (m) return m;
  }
  return models[0] || null;
}

/**
 * The ordered list of { provider, model } to try for this kind, skipping anything resting.
 * Also returns the ones skipped and why, so the answer can say so.
 */
export async function candidates(kind) {
  const have = connected().map((p) => p.id);
  const order = PLAN[kind].providers.filter((id) => have.includes(id));
  const list = [], skipped = [];
  for (const id of order) {
    const p = PROVIDERS.find((x) => x.id === id);
    if (isResting(id)) { skipped.push(`${p.name} is resting after its limit`); continue; }
    try {
      const models = await listModels(p);
      const model = pickModel(kind, models);
      if (model) list.push({ provider: p, model });
    } catch (err) {
      skipped.push(`${p.name} didn't answer (${err.status || 'network'})`);
    }
  }
  return { list, skipped };
}

/**
 * Decide the kind. Uses the rules; if they aren't sure, asks the fastest connected model for one
 * word (with a 4 s timeout), and falls back to the rules' guess.
 */
export async function decideKind(text, askFast) {
  const guess = ruleKind(text);
  if (guess.sure || !askFast) return { ...guess, by: 'rules' };
  try {
    const word = await Promise.race([
      askFast(`Classify this user request with exactly one word from: coding, quick, writing, math, deep.\n\nRequest: ${text.slice(0, 1500)}`),
      new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 4000)),
    ]);
    const kind = Object.keys(KINDS).find((k) => word.toLowerCase().includes(k));
    if (kind) return { kind, sure: true, by: 'model' };
  } catch {}
  return { ...guess, by: 'rules' };
}
