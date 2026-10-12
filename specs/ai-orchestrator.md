# AI Orchestrator (spec)

**The founder's prompt (12 Oct, his words):**

> there are many free tire models. I want all of them into single account. I mean let say if there is an app which has access to all of my free capacities like claude, openai, gemini, grok and everything. and there is jev which is deeciding to route the question to best model and available model. and get the naser. this way i will have more token right? i dont have to worry about navigating to differetn models
>
> I wnt easy way to fetch the keys

**What was built:**

- **Connect:** Gemini, Groq, OpenRouter free models, Cerebras and Mistral. Claude, OpenAI and Grok are left out because their APIs aren't free.
  - OpenRouter: one-click Connect.
  - Others: a "Get key" link to each key page and one paste box that recognises the service.
- **Judge:** keyword rules, then the fastest connected model if the rules are unsure. Jev (jevai.org, a decision model by TypeSafe AI) can replace this step once a Jev key is available.
- **Routing:** a provider order and model ranking per kind of question, skipping anything resting after a free-tier limit. On a 429 it moves to the next candidate.
- **Each answer shows** the kind, the model that answered and what was skipped. A per-service count of answers today.
- **No server:** everything runs in the browser and keys stay in localStorage.
