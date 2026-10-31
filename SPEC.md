# Hivemind — 1,000 voices, one mind

## Product

Hivemind listens to Twitch chat, groups messages into opinions, and speaks to the streamer as one animated voice. It also has a no-login sandbox that runs in the browser.

## Runtime and deployment

- Node 20+, TypeScript, Express, `ws`; static overlay and dashboard are plain HTML/CSS/JS.
- One Render Free Node web service. Build with `npm ci && npm run build`, start with `node dist/server.js`, health check `GET /health`.
- All room, OAuth-token, and audio state is in memory. Restarts clear it. Never rely on persistent local files.
- Bind to `process.env.PORT`. `PUBLIC_BASE_URL` is the public origin and OAuth redirect URI is `${PUBLIC_BASE_URL}/auth/callback`.
- Render free services sleep while idle. The landing page shows a waking state while the service starts.

## Rooms and limits

- Twitch: **Log in with Twitch** uses authorization-code OAuth, creates one room for the authorized channel, and starts a dedicated EventSub WebSocket and pipeline. Each room owns its message buffer, window, settings, state, tokens, and clients. Limit: 20 active Twitch rooms.
- `/overlay/:roomId` is the OBS source. `/dashboard/:roomId?key=<secret>` is its keyed control panel. OAuth success displays both URLs.
- Sandbox: `POST /api/sandbox` creates a room for a browser visitor. The landing page embeds its overlay and provides viewer chat, scenario simulation, and fake raid/sub/cheer/follow events. Limit: 10 active sandboxes; expire 10 minutes after last activity.
- `POST /api/sandbox/:roomId/chat` and `POST /api/sandbox/:roomId/scenario` are IP rate limited. Twitch logins are rate limited by IP.
- A window samples at most 150 messages. Rooms without an overlay client pause processing. TTS is generated only while an overlay client is connected.
- `TWITCH_CHANNEL` and `SIM_ENABLED` are optional local-only compatibility settings; public sandboxes do not require `SIM_ENABLED`.
- A missing room sends an overlay status containing a reconnect URL so it can display “Reconnect at <site>”.

## Pipeline

For each unpaused room with an overlay client, on each `WINDOW_SECONDS` interval: moderate the sampled batch, drop flagged messages, dedupe spam, make one embeddings call, cluster by cosine similarity, then make one structured chat call with up to the top 10 embedding clusters. The model merges intent groups (maximum three); `isOpinion=false` groups are suppressed, shares are combined, and examples/evidence are retained. Generate speech only when the overlay is connected and TTS is unmuted. OpenAI failures leave the previous overlay state intact.

## HTTP routes

- `GET /` landing page; `GET /health` readiness and in-memory room counts.
- `GET /auth/login`, `GET /auth/callback` Twitch OAuth.
- `GET /overlay/:roomId`, `GET /dashboard/:roomId?key=...`.
- `POST /api/sandbox`, `GET /api/sandbox/:roomId`, `POST /api/sandbox/:roomId/chat`, `/scenario`, `/event`.
- `GET /api/dashboard/:roomId?key=...`, `POST /api/dashboard/:roomId/settings?key=...`, `/ask?key=...`.
- `GET /tts/:id.mp3` serves in-memory audio. `POST /ingest` is retained for local simulator compatibility only.

## WebSocket contract

Connect overlays to `/ws?roomId=<roomId>&role=overlay`; dashboards use `role=dashboard` and their key. The server broadcasts the same payload shape to clients in that room only:

```jsonc
{ "type": "hive_update", "mood": "hyped", "intensity": 0.0,
  "line": "Chat is begging you to take the left door.", "audioUrl": "/tts/abc.mp3",
  "clusters": [{ "label": "go left", "share": 0.58, "examples": ["LEFT", "left door!!"] }],
  "msgsPerMin": 412, "windowSeconds": 20 }
{ "type": "event", "kind": "raid|sub|cheer|follow", "user": "name", "amount": 120 }
{ "type": "status", "connected": true, "paused": false }
```

For a missing/expired room, status may include `reconnectUrl`. This is an additive field; normal room messages retain the stable contract above.

## Environment

`PUBLIC_BASE_URL`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, optional local `TWITCH_CHANNEL`, `OPENAI_API_KEY`, `OPENAI_CHAT_MODEL`, `OPENAI_EMBED_MODEL`, `OPENAI_MODERATION_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE`, `CLUSTER_THRESHOLD`, `WINDOW_SECONDS`, optional local `SIM_ENABLED`, and `PORT`.
