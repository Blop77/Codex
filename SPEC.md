# Hivemind — 1,000 voices, one mind

Codex x TwitchCon Hackathon. Deadline **Nov 2, 2026, 2:00 PM PT**.

## Pitch
Big Twitch chats move too fast to read. Hivemind listens to all of chat, groups what
people are actually saying, and speaks back to the streamer as **one animated character**
whose mood is the mood of the room. A live consensus meter shows what chat thinks, by %.

## Core features (must ship)
1. **Ingest** — read chat via EventSub WebSocket (`channel.chat.message`). Also listen to
   `channel.raid`, `channel.subscribe`, `channel.cheer`, `channel.follow`.
2. **Moderate** — every message goes through OpenAI moderation; flagged messages are dropped
   and never influence the Hivemind.
3. **Cluster** — every `WINDOW_SECONDS` (default 20s), embed the window's messages and group
   them (cosine similarity). Drop spam/duplicates. Output top 3 clusters with share %.
4. **Speak** — an LLM labels each cluster ("go left", "buy the sword") and writes one short
   in-character line from the Hivemind to the streamer, plus a mood
   (`hyped | bored | salty | confused | wholesome | chaotic`).
5. **Overlay** — OBS browser source at `/overlay`: animated face (mood-driven), speech bubble,
   TTS audio, consensus meter (top 3 + %), message-rate counter.
6. **Events** — raid: Hivemind "absorbs" raiders (visual swell + line). Sub/cheer/follow:
   mood boost + shoutout line.
7. **Simulator** — `npm run sim` floods the server with realistic fake chat (configurable
   msgs/min and scenario) so the demo can show 500+ msgs/min.
8. **Streamer dashboard** at `/dashboard` — window size, persona, mute TTS, pause, and an
   "Ask chat" button that posts a question and reports the consensus.

## Stretch (only after core works end-to-end)
- **Hivemind Clash** — on a raid between two channels both running Hivemind, both overlays
  show both Hiveminds debating; both chats vote with `!red` / `!blue`.

## Architecture
```
Twitch EventSub WS ─┐
Simulator (HTTP) ───┼─> server (Node/TS) ─> moderation ─> window buffer
                    │        every N s: embed → cluster → LLM label+line+mood → TTS
                    │                          │
                    └──────────────────────────┴─> WebSocket /ws ─> overlay + dashboard
```
- Node 20+, TypeScript, Express, `ws`. Overlay/dashboard = plain HTML/CSS/JS (no build step).
- No database needed; state in memory.
- EventSub over **WebSocket** (no public URL needed) using a **user access token** from
  OAuth (authorization code flow at `/auth/login`).

## Server → overlay WebSocket contract (`/ws`)
Lets the overlay be built in parallel against mock data.
```jsonc
{ "type": "hive_update",
  "mood": "hyped", "intensity": 0.0-1.0,
  "line": "Chat is begging you to take the left door.",
  "audioUrl": "/tts/abc123.mp3",           // null if TTS muted
  "clusters": [ { "label": "go left", "share": 0.58, "examples": ["LEFT", "left door!!"] } ],
  "msgsPerMin": 412, "windowSeconds": 20 }
{ "type": "event", "kind": "raid|sub|cheer|follow", "user": "name", "amount": 120 }
{ "type": "status", "connected": true, "paused": false }
```

## Env vars (`.env`, never committed — see `.env.example`)
`TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_REDIRECT_URI`, `TWITCH_CHANNEL`,
`OPENAI_API_KEY`, `OPENAI_CHAT_MODEL`, `OPENAI_EMBED_MODEL`, `OPENAI_TTS_MODEL`,
`WINDOW_SECONDS`, `PORT`.

## Team
| Who | Owns |
|---|---|
| A — main Codex thread | server, Twitch OAuth + EventSub, moderation, clustering, LLM, TTS |
| B | overlay + dashboard UI against the WS contract |
| C | simulator, Hivemind Clash, README setup steps |
| D | test Twitch channels/OBS, demo recording, video, Devpost write-up |

## Submission checklist
- [ ] Public repo with README setup steps, `.env.example`, no secrets
- [ ] Codex session ID of A's main thread (`/status`)
- [ ] YouTube video < 3 min: working on Twitch + Codex build footage
- [ ] Devpost description + all 4 teammates accepted, **Submitted** (not draft)
