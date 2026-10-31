# Demo video brief: Hivemind (Codex x TwitchCon)

Goal: a **2:45–2:55** 3840x2160 (4K) MP4 with an **AI voiceover** (OpenAI TTS) and **burned-in subtitles**,
ready for YouTube. Hard limit: under 3:00.

Rules from the hackathon: the video must show the project **working on Twitch** and **how it was built with Codex**.
No copyrighted music, games, or other streamers' content. No background music.

## Pipeline (`npm run video`)
All code lives in `video/`. Use only npm packages, no global installs: `ffmpeg-static`, `ffprobe-static`, `playwright`
(`npx playwright install chromium`), and the existing `openai` + `dotenv`.

1. **Voiceover**: for each scene below, call OpenAI TTS (`OPENAI_TTS_MODEL`, female voice from `VIDEO_VOICE`, default `nova`,
   with delivery from `VIDEO_VOICE_INSTRUCTIONS`, default: warm, bright, confident female narrator, natural pacing). Cache the result in `video/build/vo/<scene>.mp3`
   and skip regeneration when the text hash hasn't changed. Measure each clip's duration with ffprobe.
2. **Subtitles**: split each scene's narration into sentence chunks of at most 42 characters per line and 2 lines per cue, and time
   them proportionally to word count across the measured VO duration. Write `video/out/hivemind-demo.srt`
   (also uploaded to YouTube as captions) and burn the same subtitles into the video: white text,
   semi-transparent black box, bottom center, bold sans-serif. Use SRT-relative sizes (`FontSize=12`, `MarginV=14` on the
   288px libass canvas) so captions scale with the output resolution.
3. **Auto-recorded footage**: use Playwright (headed Chromium, 1920x1080 viewport at 2x device scale, 3840x2160 `recordVideo`) to record the site at
   `VIDEO_BASE_URL` (default `https://hivemind-qefg.onrender.com`). Wake it with `/health` first and wait until it responds.
   - `landing.webm`: the landing page, slow scroll.
   - `sandbox.webm`: click "Try it now", start the `wrong-way` scenario, type 3 chat messages into the chat box with
     human-like typing, and wait for 2 Hivemind updates. Record the embedded overlay so the meter and voice line are visible.
   - `events.webm`: start the `hype-moment` scenario, wait for a fresh Hivemind update, then press the fake raid, sub and
     cheer buttons 6s apart. The scene starts at the first event, skipping the wait.
   All recordings share one sandbox room per build, so rebuilds don't fill the 10-room limit.
   - `dashboard.webm`: open the dashboard, use "Ask chat" with "Boss or loot first?" while the boss-fight scenario runs.
   Recording must use real live results. Never fake overlay output.
4. **Human-recorded clips** (we record these ourselves) are picked up from `video/clips/` if present:
   - `twitch.mp4`: a real Twitch stream with the Hivemind overlay in OBS and teammates chatting. **Required for submission.**
   - `codex.mp4`: screen recording of our Codex thread (the prompts, then Codex editing code and running tests).
   - `hook.mp4`: optional fast-scrolling Twitch chat.
   If a clip is missing, render a dark title card saying `[ PLACEHOLDER: twitch.mp4 ]`, so the timeline still builds.
5. **Title cards and diagram**: render them as HTML pages screenshotted or recorded by Playwright (dark background `#0b0b12`,
   purple accent `#9146ff`, white text). Include the logo card "HIVEMIND: 1,000 voices, one mind", a "How it works" diagram
   (Twitch EventSub → Moderation → Embeddings → `OPENAI_CHAT_MODEL` (GPT-4o mini) intent merge → Voice + overlay) with the boxes appearing one by one,
   and an outro with the live URL and the GitHub repo.
6. **Assembly**: each scene's length is `max(VO duration + 0.4s, minimum)`. Fit the footage to the scene: trim, or slow-loop a still
   tail. Never speed up overlay footage. Use 0.3s crossfades between scenes. Mix the scene VO at full volume. Keep the
   `twitch.mp4` original audio at 25% under the VO, so the Hivemind's own voice is audible, and mute all other footage.
   Encode H.264 + AAC at 30fps to `video/out/hivemind-demo.mp4`. Print the final duration, and fail if it is ≥ 2:58.
7. `.gitignore` `video/build/`, `video/out/` and `video/clips/`. Add a README section "Making the demo video".

## Scenes and narration (keep the wording; trim only if total > 2:55)

| # | Scene | Footage | Narration |
|---|---|---|---|
| 1 | Hook | `hook.mp4`, otherwise the first 8s of `twitch.mp4` | "When a Twitch chat moves this fast, nobody gets heard. Not the viewers. Not even the streamer." |
| 2 | Title | logo card | "This is Hivemind. A thousand voices, one mind." |
| 3 | Live on Twitch | `twitch.mp4` | "Hivemind reads every chat message live through Twitch EventSub. Every 20 seconds (`WINDOW_SECONDS`) it finds what chat actually agrees on, and speaks it out loud, as one character, right on stream. The meter shows the top opinions. The face shows the mood of the room: hyped, salty, confused, or chaotic." |
| 4 | How it works | diagram card | "Under the hood, every message passes OpenAI moderation first, so trolls can't hijack the voice. Embeddings group messages by meaning, so 'left', 'take the left door' and 'go left at the statue' count as one opinion. GPT-4o mini (`OPENAI_CHAT_MODEL`) merges those groups into intents, picks the mood, and writes the line." |
| 5 | Try it | `landing.webm`, then `sandbox.webm` | "And judges don't have to install anything. Open the live site, hit Try it now, and you get your own sandbox. Type as chat, or run a scenario with hundreds of simulated viewers." |
| 6 | Events and dashboard | `events.webm`, then `dashboard.webm` | "Raids, subs and cheers make the Hivemind react. And from the dashboard, the streamer can ask chat a question and hear the crowd's answer." |
| 7 | Built with Codex | `codex.mp4` | "We built Hivemind with OpenAI Codex, in one main thread. We gave it a spec and a rulebook, and it scaffolded the server, wired up Twitch OAuth and EventSub, and built the overlay, the simulator and the tests. When live testing showed one opinion split into three bars, Codex added an AI merge step and fixed it. Then it made the app multi-tenant and ready to deploy online." |
| 8 | Outro | outro card | "Streamers: log in with Twitch, paste one link into OBS, and let your chat speak with one voice. Hivemind. Try it now." |
