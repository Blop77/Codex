# Demo video brief: Hivemind (Codex x TwitchCon), v2

Goal: a **4K (3840x2160), about 2:25** hackathon submission video with an **upbeat female AI voiceover**
and **subtitles** (burned in, plus `hivemind-demo.srt` for YouTube). Hard limit: under 3:00. It must show
Hivemind **working on Twitch** and **how it was built with OpenAI Codex**. No background music.

Build: `npm run video` → `video/out/hivemind-demo.mp4` + `video/out/hivemind-demo.srt`.

## Scenes

| # | Scene | Visual | Narration (summary) |
|---|-------|--------|---------------------|
| 1 | Cold open | Motion: a flooding Twitch chat, then 3 messages highlighted | A boss-fight chat; hundreds of msgs/min; the streamer reads ~3. |
| 2 | Title | Motion: hundreds of dots converge into the Hivemind orb | "So we built Hivemind. A thousand voices. One mind." |
| 3 | Live on Twitch | `video/clips/twitch.mp4` (real stream, overlay in OBS), Hivemind heard at full volume, narration pauses for it | Every few seconds it finds ≤3 top opinions, says them aloud, mood face. |
| 4 | How it works | Motion, synced line by line: chat → moderation → embeddings → GPT merge → TTS | Moderation, meaning clusters, intent merge, voice, one batch per window. |
| 5 | Try it | Live site: landing → sandbox chat → boss-fight scenario; then the real overlay page full screen | No-login sandbox, scenarios, the meter settling. |
| 6 | Streamer controls | Live overlay: fake raid/sub/cheer; then the dashboard's "Ask the hive" | Events and asking chat a question. |
| 7 | Built with Codex | `video/clips/codex.mp4` (if present), then the real commit history from `git log` | Spec + rulebook, one prompt at a time, what Codex built, the merge-step fix, multi-room deploy. |
| 8 | Outro | Motion: orb, 3 steps, live URL, repo | Log in, paste one link into OBS, try it now. |

The exact narration lives in `scenes` in `video/generate.mjs`. It names neither a window length nor a chat
model: the window is set per room (the clips show 15s and 10s), and the local `.env` can differ from the deployed
site. `VIDEO_CHAT_MODEL_LABEL` sets the model label in the diagram (default "GPT model").

## How it is made

- **Voice**: OpenAI TTS (`OPENAI_TTS_MODEL`), one call per sentence, voice `VIDEO_VOICE` (default `nova`), delivery
  `VIDEO_VOICE_INSTRUCTIONS` (default upbeat, brisk female narrator), lead/tail silence trimmed, sped up with
  `atempo` (`VIDEO_VOICE_SPEED`, default 1.08). Cached in `video/build/vo/`.
- **Subtitles**: one cue group per sentence, so captions are timed to the real audio (≤42 chars/line, ≤2 lines).
- **Motion graphics**: HTML pages with a deterministic `renderAt(t)`, screenshotted frame by frame at true 4K and
  synced to each sentence's start time. Cached in `video/build/motion/`.
- **Live site**: Playwright records `VIDEO_BASE_URL` (default the Render demo) at 1080p, upscaled to 4K (Playwright
  can't record above the viewport size). All recordings share **one** sandbox room. The overlay page gets a dark
  backdrop because it is transparent for OBS. Real results only: never fake overlay output.
- **Human clips** in `video/clips/`: `twitch.mp4` (**required for submission**; a placeholder card is used until it
  exists) and `codex.mp4` (optional). If `twitch.mp4` has audio, the script finds where Hivemind speaks and starts
  the clip so Hivemind talks right after "Then it says them out loud…". The narrator never talks over Hivemind,
  and the clip is at full volume while Hivemind speaks. The scene runs until the last Hivemind line in the clip
  ends, so trim `twitch.mp4` down to the lines you want heard. Start offsets: `VIDEO_TWITCH_START` (overrides the
  automatic start), `VIDEO_CODEX_START` (seconds).

## Flags

- `npm run video -- --dry`: silent, estimated narration; no OpenAI calls. Good for checking visuals.
- `npm run video -- --no-site`: skip the live-site recordings (placeholder cards).
- `npm run video -- --reuse`: reuse the last live-site recordings (no new sandbox room).
- `npm run video -- --headless`: run the browser without a window.
- `VIDEO_PRESET` sets the final x264 preset (default `medium`; `fast` renders quicker).
