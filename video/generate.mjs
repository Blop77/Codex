import 'dotenv/config';
import OpenAI from 'openai';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, access, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const videoDir = path.join(root, 'video');
const clipsDir = path.join(videoDir, 'clips');
const buildDir = path.join(videoDir, 'build');
const voDir = path.join(buildDir, 'vo');
const recordDir = path.join(buildDir, 'recordings');
const cardDir = path.join(buildDir, 'cards');
const sceneDir = path.join(buildDir, 'scenes');
const outDir = path.join(videoDir, 'out');
const finalPath = path.join(outDir, 'hivemind-demo.mp4');
const subtitlePath = path.join(outDir, 'hivemind-demo.srt');
const baseUrl = (process.env.VIDEO_BASE_URL || 'https://hivemind-qefg.onrender.com').replace(/\/$/, '');
const repoUrl = process.env.VIDEO_REPO_URL || 'https://github.com/Blop77/Codex';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// 4K output. Playwright's video recorder can't capture above the 1080p viewport (frames come out
// padded), so live-site recordings are 1080p and upscaled; still cards are screenshotted at true 4K.
const OUT_W = 3840, OUT_H = 2160, VIEW_W = 1920, VIEW_H = 1080, SCALE = OUT_W / VIEW_W;
const voiceSpeed = Math.min(1.5, Math.max(0.8, Number(process.env.VIDEO_VOICE_SPEED) || 1.12));
// Narration must match what the deployed site does (render.yaml). These read the same env vars.
const windowSeconds = Math.max(5, Number(process.env.WINDOW_SECONDS) || 20);
const chatModelLabel = (process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini').replace(/^gpt/i, 'GPT').replace(/-mini$/i, ' mini');
const ffmpeg = ffmpegStatic;
const ffprobe = ffprobeStatic.path;

const scenes = [
  { id: 'hook', title: 'Hook', text: 'When a Twitch chat moves this fast, nobody gets heard. Not the viewers. Not even the streamer.', min: 12, footage: [] },
  { id: 'title', title: 'Title', text: 'This is Hivemind. A thousand voices, one mind.', min: 8, footage: [] },
  { id: 'live', title: 'Live on Twitch', text: `Hivemind reads every chat message live through Twitch EventSub. Every ${windowSeconds} seconds it finds what chat actually agrees on, and speaks it out loud, as one character, right on stream. The meter shows the top opinions. The face shows the mood of the room: hyped, salty, confused, or chaotic.`, min: 28, footage: [] },
  { id: 'how', title: 'How it works', text: `Under the hood, every message passes OpenAI moderation first, so trolls can't hijack the voice. Embeddings group messages by meaning, so “left”, “take the left door” and “go left at the statue” count as one opinion. ${chatModelLabel} merges those groups into intents, picks the mood, and writes the line.`, min: 22, footage: [] },
  { id: 'try', title: 'Try it', text: 'And judges don\'t have to install anything. Open the live site, hit Try it now, and you get your own sandbox. Type as chat, or run a scenario with hundreds of simulated viewers.', min: 23, footage: [] },
  { id: 'events', title: 'Events and dashboard', text: 'Raids, subs and cheers make the Hivemind react. And from the dashboard, the streamer can ask chat a question and hear the crowd\'s answer.', min: 30, footage: [] },
  { id: 'codex', title: 'Built with Codex', text: 'We built Hivemind with OpenAI Codex, in one main thread. We gave it a spec and a rulebook, and it scaffolded the server, wired up Twitch OAuth and EventSub, and built the overlay, the simulator and the tests. When live testing showed one opinion split into three bars, Codex added an AI merge step and fixed it. Then it made the app multi-tenant and ready to deploy online.', min: 30, footage: [] },
  { id: 'outro', title: 'Outro', text: 'Streamers: log in with Twitch, paste one link into OBS, and let your chat speak with one voice. Hivemind. Try it now.', min: 18, footage: [] }
];

function checkBinaries() {
  if (!ffmpeg || !ffprobe) throw new Error('ffmpeg-static or ffprobe-static did not resolve a bundled binary.');
}
async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function run(binary, args) {
  try { return await execFileAsync(binary, args, { cwd: root, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }); }
  catch (error) {
    const detail = [error.stderr, error.stdout, error.message].filter(Boolean).join('\n');
    throw new Error(`${path.basename(binary)} failed: ${detail.slice(-6000)}`);
  }
}
async function probe(file) {
  const { stdout } = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file]);
  const duration = Number(JSON.parse(stdout).format?.duration);
  if (!Number.isFinite(duration)) throw new Error(`Could not measure media duration: ${file}`);
  return duration;
}
function hash(text) { return createHash('sha256').update(text).digest('hex'); }
async function generateVoiceovers() {
  const voice = process.env.VIDEO_VOICE || 'nova';
  const instructions = process.env.VIDEO_VOICE_INSTRUCTIONS || 'Upbeat, energetic female tech-demo narrator with a brisk, lively pace. Bright and confident, like a launch video. Keep pauses short and keep the energy up.';
  for (const scene of scenes) {
    const audioPath = path.join(voDir, `${scene.id}.mp3`);
    const metadataPath = path.join(voDir, `${scene.id}.json`);
    const textHash = hash(`${scene.text}\n${process.env.OPENAI_TTS_MODEL}\n${voice}\n${instructions}`);
    let cached = false;
    if (await exists(audioPath) && await exists(metadataPath)) {
      try { cached = JSON.parse(await readFile(metadataPath, 'utf8')).hash === textHash; } catch {}
    }
    if (!cached) {
      const response = await openai.audio.speech.create({
        model: process.env.OPENAI_TTS_MODEL,
        voice,
        input: scene.text,
        instructions,
        response_format: 'mp3'
      });
      await writeFile(audioPath, Buffer.from(await response.arrayBuffer()));
      await writeFile(metadataPath, JSON.stringify({ hash: textHash, model: process.env.OPENAI_TTS_MODEL, voice }));
      console.log(`TTS generated: ${scene.id}`);
    } else console.log(`TTS cached: ${scene.id}`);
    // Speed up the narration without changing pitch (VIDEO_VOICE_SPEED, default 1.12).
    scene.voice = audioPath;
    if (voiceSpeed !== 1) {
      scene.voice = path.join(voDir, `${scene.id}-x${voiceSpeed}.wav`);
      await run(ffmpeg, ['-y', '-i', audioPath, '-filter:a', `atempo=${voiceSpeed}`, scene.voice]);
    }
    scene.voiceDuration = await probe(scene.voice);
    scene.duration = Math.max(scene.voiceDuration + 0.4, scene.min);
  }
}

async function waitForSite() {
  const deadline = Date.now() + 150_000;
  let lastError = 'no response';
  console.log(`Waking live site: ${baseUrl}/health`);
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(12_000) });
      if (response.ok) { console.log(`Live site ready: ${response.status}`); return; }
      lastError = `HTTP ${response.status}`;
    } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  throw new Error(`Live site did not wake at ${baseUrl}/health: ${lastError}`);
}

async function recordPage(browser, fileName, configure) {
  const context = await browser.newContext({ viewport: { width: VIEW_W, height: VIEW_H }, deviceScaleFactor: 1, recordVideo: { dir: recordDir, size: { width: VIEW_W, height: VIEW_H } } });
  const page = await context.newPage();
  const video = page.video();
  try { await configure(page); }
  catch (error) { await context.close(); throw new Error(`Recording ${fileName} failed: ${error instanceof Error ? error.message : error}`); }
  await context.close();
  const temp = await video.path();
  const destination = path.join(recordDir, fileName);
  await video.saveAs(destination).catch(async () => rename(temp, destination));
  console.log(`Recorded ${fileName}`);
  return destination;
}

// One sandbox room per build: every recording reuses it, so rebuilds don't fill the 10-room limit.
let sharedRoomId = '';
async function createSharedRoom() {
  const response = await fetch(`${baseUrl}/api/sandbox`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(20_000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.roomId) throw new Error(`Sandbox creation failed: ${response.status} ${data.error || ''}`.trim());
  sharedRoomId = data.roomId;
  console.log(`Using sandbox room ${sharedRoomId} for all recordings.`);
}
async function useSharedRoom(page) {
  if (sharedRoomId) await page.addInitScript((id) => localStorage.setItem('hivemind-sandbox-room', id), sharedRoomId);
}
async function countHiveUpdates(page) {
  await page.addInitScript(() => {
    const Original = window.WebSocket;
    // Count only real hive_update frames from the embedded live overlay.
    window.addEventListener('message', (event) => { if (event.data?.kind === 'hivemind-update') window.__hiveUpdates = (window.__hiveUpdates || 0) + 1; });
    window.WebSocket = function(url, protocols) {
      const ws = protocols === undefined ? new Original(url) : new Original(url, protocols);
      ws.addEventListener('message', (event) => { try { if (JSON.parse(event.data).type === 'hive_update') { window.__hiveUpdates = (window.__hiveUpdates || 0) + 1; if (window.parent !== window) window.parent.postMessage({ kind: 'hivemind-update' }, '*'); } } catch {} });
      return ws;
    };
    window.WebSocket.prototype = Original.prototype;
    Object.assign(window.WebSocket, Original);
  });
}
async function recordSite(browser) {
  await createSharedRoom();
  const offsets = {};
  const landing = await recordPage(browser, 'landing.webm', async (page) => {
    await useSharedRoom(page);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(1500);
    for (let i = 0; i < 36; i++) { await page.evaluate(() => window.scrollBy({ top: 18, behavior: 'smooth' })); await page.waitForTimeout(350); }
    await page.waitForTimeout(1500);
  });

  let sandboxRoomId = sharedRoomId;
  const sandbox = await recordPage(browser, 'sandbox.webm', async (page) => {
    await useSharedRoom(page);
    await countHiveUpdates(page);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const linkCta = page.getByRole('link', { name: /try it now/i }).first();
    const buttonCta = page.getByRole('button', { name: /try it now/i }).first();
    if (await linkCta.isVisible().catch(() => false)) await linkCta.click();
    else if (await buttonCta.isVisible().catch(() => false)) await buttonCta.click();
    else if (await page.locator('#sandbox').count()) await page.locator('#sandbox').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => !!localStorage.getItem('hivemind-sandbox-room'), null, { timeout: 15_000 }).catch(() => undefined);
    sandboxRoomId = await page.evaluate(() => localStorage.getItem('hivemind-sandbox-room')) || '';
    if (!sandboxRoomId) {
      const created = await page.evaluate(async () => { const r = await fetch('/api/sandbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (!r.ok) throw Error(`Sandbox creation failed: ${r.status}`); return r.json(); });
      sandboxRoomId = created.roomId;
      await page.evaluate((id) => localStorage.setItem('hivemind-sandbox-room', id), sandboxRoomId);
      await page.goto(`${baseUrl}/overlay/${sandboxRoomId}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      // Preserve the real OBS overlay in the recording if the deployed landing lacks embedded controls.
    }
    await page.locator('#overlay').waitFor({ state: 'attached', timeout: 20_000 }).catch(() => undefined);
    if (await page.locator('#message').count()) {
      if (await page.getByRole('button', { name: /wrong way/i }).count()) await page.getByRole('button', { name: /wrong way/i }).click();
    }
    const input = page.locator('#message');
    for (const message of ['LEFT DOOR, trust!', 'We should check the map first', 'Go left with the marker!']) {
      if (await input.count()) { await input.click(); await input.fill(''); await input.pressSequentially(message, { delay: 75 }); await input.press('Enter'); await page.waitForTimeout(700); }
      else await page.evaluate(async ({ id, text }) => fetch(`/api/sandbox/${id}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'Guest', text }) }), { id: sandboxRoomId, text: message });
    }
    if (!await page.getByRole('button', { name: /wrong way/i }).count()) await page.evaluate(async (id) => fetch(`/api/sandbox/${id}/scenario`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario: 'wrong-way' }) }), sandboxRoomId);
    await page.waitForFunction(() => (window.__hiveUpdates || 0) >= 2, null, { timeout: 120_000 });
    await page.waitForTimeout(2000);
  });

  const events = await recordPage(browser, 'events.webm', async (page) => {
    const began = Date.now();
    await useSharedRoom(page);
    await countHiveUpdates(page);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => !!localStorage.getItem('hivemind-sandbox-room'), null, { timeout: 15_000 }).catch(() => undefined);
    const id = await page.evaluate(() => localStorage.getItem('hivemind-sandbox-room')) || sandboxRoomId;
    const hasFakeButtons = await page.getByRole('button', { name: /fake raid/i }).count();
    if (!hasFakeButtons) await page.goto(`${baseUrl}/overlay/${id}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    if (hasFakeButtons) await page.locator('#overlay').scrollIntoViewIfNeeded().catch(() => undefined);
    // Fill the room with chat first, so the overlay shows live opinions instead of "The hive is listening…".
    const hype = page.getByRole('button', { name: /hype moment/i });
    if (await hype.count()) await hype.click();
    else await page.evaluate(async (roomId) => fetch(`/api/sandbox/${roomId}/scenario`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario: 'hype-moment' }) }), id);
    const before = await page.evaluate(() => window.__hiveUpdates || 0);
    await page.waitForFunction((n) => (window.__hiveUpdates || 0) > n, before, { timeout: (windowSeconds + 40) * 1000 }).catch(() => console.warn('No fresh hive_update before events; recording anyway.'));
    await page.waitForTimeout(2500);
    offsets.events = Math.max(0, (Date.now() - began) / 1000 - 1);
    for (const event of ['raid', 'sub', 'cheer']) {
      if (hasFakeButtons) await page.getByRole('button', { name: new RegExp(`fake ${event}`, 'i') }).click();
      else await page.evaluate(async ({ roomId, kind }) => fetch(`/api/sandbox/${roomId}/event`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind }) }), { roomId: id, kind: event });
      await page.waitForTimeout(6000);
    }
    await page.waitForTimeout(1000);
  });

  const dashboard = await recordPage(browser, 'dashboard.webm', async (page) => {
    await useSharedRoom(page);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => !!localStorage.getItem('hivemind-sandbox-room'), null, { timeout: 15_000 }).catch(() => undefined);
    let id = await page.evaluate(() => localStorage.getItem('hivemind-sandbox-room'));
    if (!id) {
      const created = await page.evaluate(async () => { const r = await fetch('/api/sandbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (!r.ok) throw Error(`Sandbox creation failed: ${r.status}`); return r.json(); });
      id = created.roomId;
      await page.evaluate((roomId) => localStorage.setItem('hivemind-sandbox-room', roomId), id);
    }
    const overlayPage = await page.context().newPage();
    await overlayPage.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await overlayPage.locator('#overlay').waitFor({ state: 'attached', timeout: 10_000 }).catch(async () => overlayPage.goto(`${baseUrl}/overlay/${id}`, { waitUntil: 'domcontentloaded', timeout: 30_000 }));
    await page.goto(`${baseUrl}/dashboard/${id}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.bringToFront();
    await page.evaluate(async (roomId) => fetch(`/api/dashboard/${roomId}/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ windowSeconds: 10 }) }), id);
    const previousLine = await page.locator('#response-line').textContent();
    await page.locator('#question').fill('Boss or loot first?');
    await page.getByRole('button', { name: /ask the hive/i }).click();
    await page.evaluate(async (roomId) => fetch(`/api/sandbox/${roomId}/scenario`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario: 'boss-fight' }) }), id);
    await page.waitForFunction((previous) => document.querySelector('#response-line')?.textContent !== previous, previousLine, { timeout: 45_000 }).catch(() => undefined);
    await page.waitForTimeout(2000);
  });
  await writeFile(path.join(recordDir, 'offsets.json'), JSON.stringify(offsets));
  return { landing, sandbox, events, dashboard, sandboxRoomId, offsets };
}

async function saveScreenshot(page, file) { await page.screenshot({ path: file, fullPage: false }); }
async function makeCards(browser) {
  const page = await browser.newPage({ viewport: { width: VIEW_W, height: VIEW_H }, deviceScaleFactor: SCALE });
  const basic = (title, subtitle) => `<!doctype html><style>*{box-sizing:border-box}body{margin:0;width:1920px;height:1080px;background:#0b0b12;color:white;font:700 46px/1.3 Arial,sans-serif;display:grid;place-items:center;text-align:center}.accent{color:#9146ff}.wrap{max-width:1450px;padding:90px}.small{font-size:28px;color:#c9c2d4;font-weight:400;margin-top:24px}.mark{width:90px;height:90px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#f6d7ff,#9146ff 48%,#33205b);box-shadow:0 0 80px #9146ff88;margin:0 auto 34px}</style><div class="wrap"><div class="mark"></div><div>${title}</div><div class="small">${subtitle}</div></div>`;
  await page.setContent(basic('<span class="accent">HIVEMIND</span><br>1,000 voices, one mind', 'A crowd voice for live Twitch chat'));
  const title = path.join(cardDir, 'title.png'); await saveScreenshot(page, title);
  await page.setContent(basic('<span class="accent">THANK YOU, CHAT</span><br>Let your crowd speak with one voice.', `${baseUrl}  ·  ${repoUrl}`));
  const outro = path.join(cardDir, 'outro.png'); await saveScreenshot(page, outro);
  for (const clip of ['twitch.mp4', 'codex.mp4', 'hook.mp4']) {
    if (await exists(path.join(clipsDir, clip))) continue;
    await page.setContent(basic(`<span class="accent">[ PLACEHOLDER: ${clip} ]</span>`, 'Human-recorded footage can be added in video/clips/ and the video rebuilt.'));
    await saveScreenshot(page, path.join(cardDir, `placeholder-${clip.replace('.mp4', '')}.png`));
    console.warn(`Missing human clip ${clip}; placeholder card will be used.`);
  }
  await page.setContent(`<!doctype html><style>*{box-sizing:border-box}body{margin:0;background:#0b0b12;color:white;width:1920px;height:1080px;font:700 36px Arial;display:flex;align-items:center;justify-content:center;gap:24px}.box{opacity:0;transform:translateY(24px);transition:all .6s;padding:28px 22px;border:2px solid #9146ff;border-radius:18px;background:#171421;min-width:275px;text-align:center}.box.show{opacity:1;transform:translateY(0)}.arrow{color:#9146ff}.label{position:absolute;top:100px;font-size:56px}</style><div class="label">HOW IT WORKS</div><div class="box">Twitch<br>EventSub</div><div class="arrow">→</div><div class="box">OpenAI<br>Moderation</div><div class="arrow">→</div><div class="box">Embeddings</div><div class="arrow">→</div><div class="box">${chatModelLabel}<br>intent merge</div><div class="arrow">→</div><div class="box">Voice +<br>overlay</div><script>document.querySelectorAll('.box').forEach((box,i)=>setTimeout(()=>box.classList.add('show'),700+i*850));</script>`);
  const diagramContext = await browser.newContext({ viewport: { width: VIEW_W, height: VIEW_H }, deviceScaleFactor: 1, recordVideo: { dir: cardDir, size: { width: VIEW_W, height: VIEW_H } } });
  const diagramPage = await diagramContext.newPage(); await diagramPage.setContent(await page.locator('body').evaluate((el) => el.parentElement.outerHTML));
  await diagramPage.waitForTimeout(6500); const diagramVideo = diagramPage.video(); await diagramContext.close();
  const diagramTemp = await diagramVideo.path(); const diagram = path.join(cardDir, 'diagram.webm');
  await diagramVideo.saveAs(diagram).catch(async () => rename(diagramTemp, diagram));
  await page.close();
  return { title, outro, diagram, placeholder: (name) => path.join(cardDir, `placeholder-${name}.png`) };
}

async function fitVisual(browser, footage, duration) {
  // visuals stay real-time: ffmpeg trims them and holds the last frame for a still tail.
  return footage.map((part) => ({ ...part, duration: part.partDuration ?? duration / footage.length }));
}
async function buildScene(scene, sceneFootage, index) {
  const output = path.join(sceneDir, `${String(index + 1).padStart(2, '0')}-${scene.id}.mp4`);
  const inputs = []; const args = ['-y'];
  for (const part of sceneFootage) {
    if (part.sourceStart) args.push('-ss', String(part.sourceStart));
    if (part.image) args.push('-loop', '1', '-framerate', '30', '-i', part.file);
    else args.push('-i', part.file);
    inputs.push(part);
  }
  const voiceIndex = inputs.length; args.push('-i', scene.voice);
  let nativeAudioIndex = -1;
  const native = sceneFootage.find((part) => part.nativeAudio);
  if (native) { nativeAudioIndex = inputs.length; args.push('-i', native.nativeAudio); }
  const filters = [];
  let current = 0;
  sceneFootage.forEach((part, i) => {
    const duration = part.duration;
    const trim = part.sourceDuration ? `trim=duration=${Math.min(part.sourceDuration, duration)},` : '';
    filters.push(`[${i}:v]${trim}scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${OUT_W}:${OUT_H},setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=${duration},trim=duration=${duration},setpts=PTS-STARTPTS[v${i}]`);
  });
  if (sceneFootage.length === 1) filters.push('[v0]null[vbase]');
  else filters.push(`${sceneFootage.map((_part, i) => `[v${i}]`).join('')}concat=n=${sceneFootage.length}:v=1:a=0[vbase]`);
  filters.push(`[${voiceIndex}:a]apad,atrim=duration=${scene.duration},asetpts=PTS-STARTPTS[voice]`);
  if (nativeAudioIndex >= 0) {
    filters.push(`[${nativeAudioIndex}:a]volume=0.25,apad,atrim=duration=${scene.duration},asetpts=PTS-STARTPTS[ambience]`);
    filters.push('[voice][ambience]amix=inputs=2:duration=longest:normalize=0,atrim=duration=' + scene.duration + '[audio]');
  } else filters.push('[voice]anull[audio]');
  args.push('-filter_complex', filters.join(';'), '-map', '[vbase]', '-map', '[audio]', '-t', String(scene.duration), '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output);
  await run(ffmpeg, args);
  scene.file = output;
  return output;
}

function wrapSubtitle(text) {
  const lines = [];
  for (const sentence of text.match(/[^.!?]+[.!?]?/g) || [text]) {
    let current = '';
    for (const word of sentence.trim().split(/\s+/)) {
      if (!word) continue;
      if (word.length > 42) {
        if (current) { lines.push(current); current = ''; }
        for (let i = 0; i < word.length; i += 42) lines.push(word.slice(i, i + 42));
      } else if (!current) current = word;
      else if (`${current} ${word}`.length <= 42) current += ` ${word}`;
      else { lines.push(current); current = word; }
    }
    if (current) lines.push(current);
  }
  const cues = [];
  for (let i = 0; i < lines.length; i += 2) cues.push(lines.slice(i, i + 2));
  return cues;
}
function srtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000)); const h = Math.floor(ms / 3_600_000); const m = Math.floor(ms % 3_600_000 / 60_000); const s = Math.floor(ms % 60_000 / 1000); const milli = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(milli).padStart(3, '0')}`;
}
function createSubtitles() {
  const cues = []; let sceneOffset = 0; let cueIndex = 1;
  for (const scene of scenes) {
    const chunks = wrapSubtitle(scene.text);
    const weights = chunks.map((chunk) => chunk.join(' ').split(/\s+/).filter(Boolean).length);
    const total = weights.reduce((sum, words) => sum + words, 0);
    let local = 0;
    chunks.forEach((chunk, i) => {
      const start = sceneOffset + local;
      const duration = scene.voiceDuration * weights[i] / total;
      const end = start + duration;
      cues.push(`${cueIndex++}\n${srtTime(start)} --> ${srtTime(end)}\n${chunk.join('\n')}`);
      local = end - sceneOffset;
    });
    sceneOffset += scene.duration - 0.3;
  }
  return cues.join('\n\n') + '\n';
}

async function assemble(cards, recordings) {
  const twitch = path.join(clipsDir, 'twitch.mp4');
  const hook = path.join(clipsDir, 'hook.mp4');
  const codex = path.join(clipsDir, 'codex.mp4');
  const placeholder = (name) => ({ file: cards.placeholder(name), image: true });
  const real = (file, extra = {}) => ({ file, ...extra });
  scenes[0].footage = await exists(hook) ? [real(hook, { nativeAudio: hook })] : await exists(twitch) ? [real(twitch, { sourceDuration: 8, nativeAudio: twitch })] : [placeholder('hook')];
  scenes[1].footage = [real(cards.title)];
  scenes[2].footage = await exists(twitch) ? [real(twitch, { nativeAudio: twitch })] : [placeholder('twitch')];
  scenes[3].footage = [real(cards.diagram)];
  scenes[4].footage = [real(recordings.landing), real(recordings.sandbox, { sourceStart: 20 })];
  scenes[5].footage = [real(recordings.events, recordings.offsets?.events ? { sourceStart: recordings.offsets.events } : {}), real(recordings.dashboard, { sourceStart: 2 })];
  scenes[6].footage = await exists(codex) ? [real(codex)] : [placeholder('codex')];
  scenes[7].footage = [real(cards.outro)];
  for (const [index, scene] of scenes.entries()) {
    const parts = await fitVisual(null, scene.footage, scene.duration);
    // Split paired demo scenes evenly so both live-site recordings appear.
    if (parts.length > 1) parts.forEach((part) => { part.duration = scene.duration / parts.length; });
    await buildScene(scene, parts, index);
  }
  await writeFile(subtitlePath, createSubtitles(), 'utf8');
  const args = ['-y']; scenes.forEach((scene) => args.push('-i', scene.file));
  const filters = [`[0:v]settb=AVTB,setpts=PTS-STARTPTS[v0]`];
  let previousDuration = scenes[0].duration;
  for (let i = 1; i < scenes.length; i++) {
    const offset = previousDuration - 0.3;
    filters.push(`[${i}:v]settb=AVTB,setpts=PTS-STARTPTS[vin${i}]`);
    filters.push(`[v${i - 1}][vin${i}]xfade=transition=fade:duration=0.3:offset=${offset}[v${i}]`);
    previousDuration += scenes[i].duration - 0.3;
  }
  filters.push('[0:a]anull[a0]');
  for (let i = 1; i < scenes.length; i++) filters.push(`[a${i - 1}][${i}:a]acrossfade=d=0.3:c1=tri:c2=tri[a${i}]`);
  const subtitleFilterPath = subtitlePath.replace(/\\/g, '/').replace(':', '\\:').replaceAll("'", "\\'");
  filters.push(`[v${scenes.length - 1}]subtitles='${subtitleFilterPath}':force_style='FontName=Arial,FontSize=12,Bold=1,PrimaryColour=&H00FFFFFF,BackColour=&H80000000,BorderStyle=3,Outline=1,Shadow=0,Alignment=2,MarginV=14'[outv]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[outv]', '-map', `[a${scenes.length - 1}]`, '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', finalPath);
  await run(ffmpeg, args);
  const duration = await probe(finalPath);
  console.log('\nScene timings (0.3s crossfades included in the overall timeline):');
  let start = 0;
  for (const scene of scenes) {
    const end = start + scene.duration;
    console.log(`${String(scenes.indexOf(scene) + 1).padStart(2, '0')} ${scene.title.padEnd(22)} ${start.toFixed(1)}s–${end.toFixed(1)}s  (${scene.duration.toFixed(1)}s VO ${scene.voiceDuration.toFixed(1)}s)`);
    start = end - 0.3;
  }
  const mm = Math.floor(duration / 60); const ss = (duration % 60).toFixed(1).padStart(4, '0');
  console.log(`\nFinal duration: ${mm}:${ss} (${duration.toFixed(2)} seconds)`);
  console.log(`Video: ${path.relative(root, finalPath)}`);
  console.log(`Subtitles: ${path.relative(root, subtitlePath)}`);
  if (duration >= 178) throw new Error(`Final duration ${duration.toFixed(2)}s is not below 2:58.`);
  if (duration < 165) throw new Error(`Final duration ${duration.toFixed(2)}s is shorter than the 2:45 target.`);
}

async function main() {
  checkBinaries();
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for the per-scene voiceover.');
  if (!process.env.OPENAI_TTS_MODEL) throw new Error('Set OPENAI_TTS_MODEL in .env before generating the demo.');
  await Promise.all([voDir, recordDir, cardDir, sceneDir, outDir, clipsDir].map((dir) => mkdir(dir, { recursive: true })));
  await generateVoiceovers();
  await waitForSite();
  const browser = await chromium.launch({ headless: false });
  try {
    const recordingNames = ['landing.webm', 'sandbox.webm', 'events.webm', 'dashboard.webm'];
    let recordings;
    if (process.env.VIDEO_REUSE_RECORDINGS === 'true') {
      for (const name of recordingNames) if (!await exists(path.join(recordDir, name))) throw new Error(`Cannot reuse missing recording ${name}.`);
      recordings = Object.fromEntries(recordingNames.map((name) => [name.replace('.webm', ''), path.join(recordDir, name)]));
      recordings.offsets = await readFile(path.join(recordDir, 'offsets.json'), 'utf8').then(JSON.parse).catch(() => ({}));
      console.log('Reusing completed real-site recordings from video/build/recordings/.');
    } else recordings = await recordSite(browser);
    const cards = await makeCards(browser);
    await assemble(cards, recordings);
  } finally { await browser.close(); }
}

main().catch((error) => { console.error(`Video pipeline failed: ${error instanceof Error ? error.message : error}`); process.exitCode = 1; });
