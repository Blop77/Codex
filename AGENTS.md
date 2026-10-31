# Instructions for Codex

Read `SPEC.md` first; it is the source of truth.

- Stack: Node 20+, TypeScript (server), Express, `ws`. Overlay/dashboard are plain HTML/CSS/JS in `public/`, no build step.
- Keep the `/ws` message contract in `SPEC.md` stable; update the spec if you must change it.
- Secrets only via `.env` (dotenv). Keep `.env.example` in sync. Never commit `.env` or tokens.
- OpenAI model names come from env vars, never hardcoded.
- Batch OpenAI calls per window (one embeddings call, one moderation call, one chat call); never one call per message.
- Everything must degrade gracefully: if OpenAI fails, keep the overlay alive and show last state.
- Scripts: `npm run dev` (server), `npm run sim` (chat simulator), `npm run build`, `npm test`.
- Small commits with clear messages.
