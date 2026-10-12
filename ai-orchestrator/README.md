# AI Orchestrator

One chat box for all your free AI accounts. It decides what kind of question you asked, sends it to the best free model you have, and switches to another when one runs out.

**Live:** https://tirupathipodugu.github.io/ideas/ai-orchestrator/

## How it works

- **Your keys, your browser.** Connect Google Gemini, Groq, OpenRouter's free models, Cerebras and Mistral:
  - OpenRouter connects in one click (OAuth PKCE).
  - Paste any other key; the shape of the key tells the app which service it belongs to (`AIza…`, `gsk_…`, `sk-or-…`, `csk-…`). Each key is tested by listing its models.
  - Keys are stored only in `localStorage`, and the page only talks to those five services (see the Content Security Policy).
- **One API for all.** All five accept calls from a web page, and all speak the same OpenAI-style chat API (Gemini through its OpenAI-compatible endpoint), so one streaming function talks to every service ([providers.js](js/providers.js)).
- **The judge** ([judge.js](js/judge.js)):
  1. Keyword rules sort the question into coding, quick fact, writing, maths or deep thinking.
  2. If they're unsure, the fastest connected model is asked for one word, with a 4 s timeout.
  3. Each kind has a provider order and a ranked list of model-name patterns, matched against the models your key can actually use, so new models are picked up automatically.
- **Fallback.**
  - A 429 rests that service (using its retry time if it gives one, otherwise 10 minutes, or 6 hours after three limits in a day) and the next candidate answers.
  - A 401 or 403 means a bad key.
  - Every answer shows its kind, the model that answered and anything that was skipped ([usage.js](js/usage.js)).
- **Plain HTML, CSS and ES modules,** no libraries, no build step, and a small safe Markdown renderer.

Free tiers are set by each service and change often; the app reads the live model list from your key rather than hard-coding one.

Part of [30 Days, 30 Apps](../) by [@tirupathipodugu](https://x.com/tirupathipodugu).
