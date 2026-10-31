# Hivemind

One animated voice for a fast moving Twitch chat. Hivemind collects chat into timed windows, moderates and clusters messages, then speaks a short consensus update on an OBS overlay.

## Setup

### 1. Create a Twitch application

1. Sign in to the [Twitch Developer Console](https://dev.twitch.tv/console/apps) and choose **Register Your Application**.
2. Set the OAuth Redirect URL to `http://localhost:3000/auth/callback` and select **Confidential** as the client type.
3. Save the application. Copy its **Client ID** and create/copy the **Client Secret**.
4. The Twitch account you authorize must be able to read the configured channel's chat. For follows, it must also be the broadcaster or a channel moderator.

### 2. Configure environment variables

Use Node.js 20 or newer, then install dependencies and create a local environment file:

```sh
npm install
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp` if needed. Edit `.env` and set:

```dotenv
TWITCH_CLIENT_ID=your_client_id
TWITCH_CLIENT_SECRET=your_client_secret
TWITCH_REDIRECT_URI=http://localhost:3000/auth/callback
TWITCH_CHANNEL=channel_login_name

OPENAI_API_KEY=your_openai_api_key
OPENAI_CHAT_MODEL=your_chat_model
OPENAI_EMBED_MODEL=your_embeddings_model
OPENAI_MODERATION_MODEL=your_moderation_model
OPENAI_TTS_MODEL=your_text_to_speech_model
OPENAI_TTS_VOICE=alloy

WINDOW_SECONDS=20
CLUSTER_THRESHOLD=0.78
SIM_ENABLED=false
PORT=3000
```

Use model names enabled for your OpenAI API account. Keep `.env` private; it is gitignored. To receive simulator traffic, set `SIM_ENABLED=true` and restart the server. `/ingest` returns 404 while simulation is disabled.

### 3. Start the server and authorize Twitch

In one terminal:

```sh
npm run build
npm run dev
```

Open [http://localhost:3000/auth/login](http://localhost:3000/auth/login) and approve the requested Twitch scopes. The callback stores tokens in the gitignored `tokens.json` file and starts the EventSub connection. The dashboard is at [http://localhost:3000/dashboard](http://localhost:3000/dashboard).

### 4. Run the chat simulator (optional)

Set `SIM_ENABLED=true` in `.env`, restart the server, then use a second terminal:

```sh
npm run sim -- --rate 500 --scenario boss-fight
```

The rate is messages per minute. Available scenarios are `boss-fight`, `wrong-way`, `hype-moment`, `bored`, and `raid`. Each shifts its weighted opinions over time and includes Twitch-style emotes, typos, repeated copypasta, spam, and occasional moderation test messages. The simulator posts each message to `POST /ingest`; press **Ctrl+C** to stop it.

### 5. Add the overlay to OBS

1. In OBS, add a **Browser** source to your scene.
2. Set its URL to `http://localhost:3000/overlay`.
3. Set width to **1920** and height to **1080**. The page background is transparent, so it layers over your gameplay.
4. Enable browser-source audio capture/control if you want to hear generated TTS in OBS. Browser autoplay policies may require enabling audio for the source.

The overlay reconnects to the server's `/ws` WebSocket automatically. Use the dashboard to change its consensus window and persona, mute TTS, pause processing, or ask chat a question.

## Development

```sh
npm run dev    # server
npm run sim    # fake chat (add -- --rate 500 --scenario boss-fight)
npm run build  # TypeScript check/build
npm test       # unit tests
```

See [SPEC.md](SPEC.md) for the message contract and architecture.
