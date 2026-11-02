# Hivemind

**1,000 voices, one mind.** Hivemind condenses a fast Twitch chat into a live consensus meter and one in-character crowd voice.

## Online demo

Try Hivemind without installing anything: **[Open the live demo](https://hivemind-qefg.onrender.com)**. The first request may take a little while while Render wakes the free service. Sandbox rooms are private to each browser and expire after 10 minutes without activity.

## How this was built

**OpenAI Codex wrote the application:** everything in `src/`, `public/`, `sim/` and `test/`. Codex commits under the repository owner's git identity, so its work shows up as Ishaan Singh's commits, and Codex never appears as a GitHub contributor. The Codex commits are:

- `c60dd87`: server, Twitch OAuth and EventSub, overlay, dashboard and chat simulator
- `2cc7143`: intent-merge step, after live tests split one opinion across three meter bars
- `c40f6fe` and `76a854a`: crowd labels and voice lines grounded in real chat evidence
- `23ad32e`: multi-room Twitch support and the online no-login sandbox
- `4183452`: the first narrated demo video pipeline
- `b2eced6`: a regression test for the intent-merge step

Codex session ID: `01a190c3-5edf-7081-9102-d4f2e1628172`

**Claude**, which is why it is listed as a contributor, helped plan `SPEC.md`, `AGENTS.md` and `PROMPTS.md` (`2973d45`), fixed README links, and built the 4K demo video in `video/`. Claude did not write application code.

## Deploy on Render Free

1. Create a Twitch application in the [Twitch Developer Console](https://dev.twitch.tv/console/apps), select **Confidential**, and add `https://<your-service>.onrender.com/auth/callback` as its OAuth redirect URL.
2. Create a Render Blueprint from this repository and apply `render.yaml`.
3. In the Render service environment, set `PUBLIC_BASE_URL`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, and `OPENAI_API_KEY`. The model defaults can be adjusted there. Keep secrets private.
4. In Twitch, ensure the authorized channel account can grant the requested scopes. Open the service URL and choose **Log in with Twitch**.
5. Copy the generated overlay URL into an OBS Browser Source at 1920×1080. The dashboard link includes a private key; keep it private.

Render's free service can sleep when idle, and its filesystem is ephemeral. Hivemind keeps rooms and Twitch authorization in memory, so a restart clears them; viewers can reconnect by returning to the landing page and logging in again.

## Local setup

Use Node 20 or newer. Register a Twitch app with `http://localhost:3000/auth/callback` as its redirect URL, then:

```sh
npm ci
cp .env.example .env
```

Set `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `OPENAI_API_KEY`, and the OpenAI model names in `.env`. Set `PUBLIC_BASE_URL=http://localhost:3000`. `TWITCH_CHANNEL` is an optional local-only channel override. Run:

```sh
npm run build
npm run dev
```

Open `http://localhost:3000` and either log in with Twitch or use **Try the sandbox**. Each browser gets its own demo room; use the chat box, scenario buttons, and fake event buttons to explore it. For legacy local simulator traffic, set `SIM_ENABLED=true` and `TWITCH_CHANNEL`, log in, then run:

```sh
npm run sim -- --rate 500 --scenario boss-fight
```

Available simulator scenarios are `boss-fight`, `wrong-way`, `hype-moment`, `bored`, and `raid`.

## Development

```sh
npm run dev    # local server
npm run sim    # optional local chat simulator
npm run build  # TypeScript build
npm test       # unit tests
```

See [SPEC.md](SPEC.md) for room routes and the WebSocket message contract.

## Making the demo video

Set `OPENAI_API_KEY` and `OPENAI_TTS_MODEL` in `.env`, then run `npm run video`. It makes a 4K video with an upbeat female voiceover (`VIDEO_VOICE`, default `nova`) and subtitles, from the live site at `VIDEO_BASE_URL` (default `https://hivemind-qefg.onrender.com`). Add `video/clips/twitch.mp4` (required) and `video/clips/codex.mp4`. Use `npm run video -- --dry` to preview without OpenAI calls. See `video/BRIEF.md` for every option.

Install the project dependencies and Playwright's bundled Chromium browser (no system ffmpeg or global browser install is used):

```sh
npm ci
npx playwright install chromium
npm run video
```

The script caches narration in `video/build/vo/` and motion graphics in `video/build/motion/`, so reruns are faster. It records the live site with Playwright, renders the motion graphics at 4K, and writes `video/out/hivemind-demo.mp4` (under 2:58) plus `hivemind-demo.srt` for YouTube captions. Missing clips get clearly marked placeholder cards. Generated media in `video/build/`, `video/out/`, and `video/clips/` is gitignored.
