# Hivemind

**1,000 voices, one mind.** Hivemind condenses a fast Twitch chat into a live consensus meter and one in-character crowd voice.

## Online demo

Try Hivemind without installing anything: **[Open the live demo](https://hivemind-qefg.onrender.com)**. The first request may take a little while while Render wakes the free service. Sandbox rooms are private to each browser and expire after 10 minutes without activity.

## Deploy on Render Free

1. Create a Twitch application in the [Twitch Developer Console](https://dev.twitch.tv/console/apps), select **Confidential**, and add `https://hivemind-qefg.onrender.com/auth/callback` as its OAuth redirect URL.
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
