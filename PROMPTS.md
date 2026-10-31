# Starter Codex prompts

Paste these into Codex, one at a time. Wait until each step runs before sending the next.
Person A's thread is **the** thread whose session ID gets submitted, so keep all core work there.

## Person A: main thread (server + Twitch + AI)

**A1: scaffold**
> Read AGENTS.md and SPEC.md. Scaffold the project: package.json with the scripts listed in AGENTS.md, a TypeScript server in `src/` (Express + ws), `.env.example`, `.gitignore`, and `public/overlay/` and `public/dashboard/` placeholders. Serve them at `/overlay` and `/dashboard`. Implement the `/ws` broadcast contract from SPEC.md. Add a `POST /dev/mock` route that broadcasts a fake `hive_update` so the overlay team can test. Run it and show me it works.

**A2: Twitch auth + EventSub**
> Add Twitch OAuth (authorization code flow): `/auth/login` and `/auth/callback`. Use scopes `user:read:chat user:bot channel:bot channel:read:subscriptions bits:read moderator:read:followers`. Store tokens in memory, plus a gitignored `tokens.json` so restarts don't need a new login, and refresh them when they expire. Then connect to the EventSub WebSocket (`wss://eventsub.wss.twitch.tv/ws`) and subscribe to `channel.chat.message`, `channel.raid` (to_broadcaster_user_id), `channel.subscribe`, `channel.cheer`, `channel.follow` v2 for `TWITCH_CHANNEL`. Handle welcome, keepalive, reconnect, and revocation messages. Log each chat message.

**A3: the Hivemind brain**
> Implement the pipeline from SPEC.md: buffer messages per window. Every WINDOW_SECONDS, send one batched OpenAI moderation call and drop flagged messages, then dedupe spam. Send one batched embeddings call, then do greedy cosine clustering (threshold configurable) and compute each cluster's share. Send one chat call with structured JSON output that returns a label per top-3 cluster, a mood, an intensity, and one short in-character `line`. Then generate TTS for the line and serve it at `/tts/:id.mp3`. Broadcast `hive_update`. Map raid/sub/cheer/follow to `event` messages plus a special line. Add unit tests for clustering and dedupe.

**A4: input from the simulator**
> Add `POST /ingest` (enabled only when `SIM_ENABLED=true`) that accepts `{user, text}` and feeds the same pipeline as Twitch chat.

## Person B: overlay + dashboard (own Codex thread)

> Read AGENTS.md and SPEC.md. Build `public/overlay/` as an OBS browser source (1920x1080, transparent background). Include an animated Hivemind face built with CSS/SVG that changes expression and color for each mood and pulses with intensity, a typewriter speech bubble, autoplayed `audioUrl` audio, a top-3 consensus meter with animated % bars and example messages, a msgs/min counter, and special animations for raid ("absorbing" swell), sub, cheer and follow. Connect to `/ws` and auto-reconnect. Then build `public/dashboard/` with controls for window size, persona, mute TTS, pause, and "Ask chat". Test with `POST /dev/mock`.

## Person C: simulator + Clash (own Codex thread)

> Read AGENTS.md and SPEC.md. Build `sim/` (`npm run sim -- --rate 500 --scenario boss-fight`). It posts realistic fake chat to `POST /ingest`. Include scenarios like boss-fight, wrong-way, hype-moment, bored and raid, with emotes, typos, spam and copypasta, and a weighted opinion mix that drifts over time so the clusters visibly change. Add a few flagged-style messages to show off moderation. Then write the README setup section: creating the Twitch app, `.env`, running it, and adding the OBS browser source.

## Later: Hivemind Clash (A or C, only once the core works)
> Implement the Hivemind Clash stretch goal from SPEC.md.
