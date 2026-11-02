// Hivemind demo video, v2. `npm run video` builds video/out/hivemind-demo.mp4 (4K) and .srt.
// See video/BRIEF.md. Flags: --dry (silent estimated narration, no OpenAI), --no-site (skip live-site
// recordings), --reuse (reuse the last recordings), --headless.
import 'dotenv/config';
import OpenAI from 'openai';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, access, rm, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const flags = new Set(process.argv.slice(2));
const DRY = flags.has('--dry') || process.env.VIDEO_DRY === 'true';
const NO_SITE = flags.has('--no-site') || process.env.VIDEO_NO_SITE === 'true';
const REUSE = flags.has('--reuse') || process.env.VIDEO_REUSE_RECORDINGS === 'true';
const HEADLESS = flags.has('--headless') || process.env.VIDEO_HEADLESS === 'true';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const videoDir = path.join(root, 'video');
const clipsDir = path.join(videoDir, 'clips');
const buildDir = path.join(videoDir, 'build');
const voDir = path.join(buildDir, 'vo');
const recDir = path.join(buildDir, 'recordings');
const motionDir = path.join(buildDir, 'motion');
const sceneDir = path.join(buildDir, 'scenes');
const outDir = path.join(videoDir, 'out');
const finalPath = path.join(outDir, 'hivemind-demo.mp4');
const srtPath = path.join(outDir, 'hivemind-demo.srt');

// Output is 4K. Motion graphics are screenshotted at true 4K (1920x1080 CSS at 2x). Live-site footage
// is recorded at 1080p, because Playwright's recorder pads frames above the viewport size, then upscaled.
const W = 3840, H = 2160, VW = 1920, VH = 1080, FPS = 30;
const LEAD = 0.35, GAP = 0.22, TAIL = 0.75, FADE = 0.2, MAX_SECONDS = 178, HIVE_PAD = 0.35;
// Real footage sits in a rounded "screen" (72% size) so the subtitle band below never covers it.
const FRAME = { x: 536, y: 200, w: 2768, h: 1556 };
const baseUrl = (process.env.VIDEO_BASE_URL || 'https://hivemind-qefg.onrender.com').replace(/\/$/, '');
const repoUrl = process.env.VIDEO_REPO_URL || 'https://github.com/Blop77/Codex';
const ttsModel = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const voice = process.env.VIDEO_VOICE || 'nova';
const voiceInstructions = process.env.VIDEO_VOICE_INSTRUCTIONS || 'Upbeat, energetic young female narrator for a tech launch video. Brisk, lively pace, bright and confident, smiling voice. Keep pauses short and the energy high.';
const voiceSpeed = Math.min(1.5, Math.max(0.8, Number(process.env.VIDEO_VOICE_SPEED) || 1.08));
const preset = process.env.VIDEO_PRESET || 'medium';
// Narration must describe what the deployed site does; these read the same env vars as the server.
const windowSeconds = Math.max(5, Number(process.env.WINDOW_SECONDS) || 20);
const chatModelLabel = (process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini').replace(/^gpt/i, 'GPT').replace(/-mini$/i, ' mini');
const ffmpeg = ffmpegStatic;
const ffprobe = ffprobeStatic.path;
const openai = DRY || !process.env.OPENAI_API_KEY ? null : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const scenes = [
  { id: 'cold', lines: [
    'This is a Twitch chat during a boss fight.',
    'Hundreds of messages a minute, all at once.',
    'The streamer can read maybe three of them.'] },
  { id: 'title', min: 7, lines: [
    'So we built Hivemind.',
    'A thousand voices. One mind.'] },
  // hiveAfter: the narrator stops after this line and the clip's own Hivemind voice is heard (see planHiveHolds).
  { id: 'twitch', min: 20, tag: 'LIVE ON TWITCH', hiveAfter: 3, lines: [
    'Here it is, live on a real Twitch stream.',
    'Hivemind listens to every message in chat.',
    `Every ${windowSeconds} seconds, it finds the top opinions, at most three, and shows them on the meter.`,
    'Then it says them out loud, as one character, right on stream.',
    'Its face follows the mood of the room. Hyped, salty, confused, or chaotic.'] },
  { id: 'how', lines: [
    'Here\'s how it works.',
    'First, OpenAI moderation checks every message, so trolls can\'t take over the voice.',
    'Next, embeddings group messages by meaning. Go left, take the left door, and left at the statue all count as one opinion.',
    `Then ${chatModelLabel} merges those groups into the top intents, picks the mood, and writes the line.`,
    'Finally, text to speech gives the hive its voice.',
    'It\'s one batch of calls per window, never one per message, so it stays fast and cheap.'] },
  { id: 'try', min: 18, tag: 'TRY IT · NO LOGIN', sub: baseUrl.replace(/^https?:\/\//, ''), lines: [
    'Judges can try it right now, with no login.',
    'Open the site and you get your own private sandbox.',
    'Type as chat, or start a scenario with hundreds of simulated viewers.',
    'Then watch the meter settle as the crowd finds its voice.'] },
  { id: 'controls', min: 18, tag: 'STREAMER CONTROLS', lines: [
    'Raids, subs and cheers get their own reactions.',
    'And from the dashboard, the streamer can ask chat a question and hear the crowd\'s answer.'] },
  { id: 'codex', lines: [
    'We built all of Hivemind with OpenAI Codex.',
    'We started with a spec and a rulebook, then gave Codex one prompt at a time.',
    'Codex built the server, Twitch login and EventSub, the overlay, the chat simulator, and the tests.',
    'When live testing showed one opinion split across three bars, Codex added a merge step to fix it.',
    'Then it made Hivemind multi-room and ready to deploy.'] },
  { id: 'outro', min: 9, lines: [
    'Streamers, log in with Twitch and paste one link into OBS.',
    'Let your chat speak with one voice.',
    'Hivemind. Try it now.'] }
];

// ---------- helpers ----------
const exists = (file) => access(file).then(() => true, () => false);
const hash = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex').slice(0, 16);
async function run(binary, args, cwd = root) {
  const quiet = binary === ffmpeg ? ['-hide_banner', '-nostats', '-loglevel', 'error'] : [];
  try { return await execFileAsync(binary, [...quiet, ...args], { cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }); }
  catch (error) { throw new Error(`${path.basename(binary)} failed (${error.signal || `exit ${error.code}`}): ${error.stderr?.toString().slice(-2500) || error.message}`); }
}
async function probe(file) {
  const { stdout } = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration)) throw new Error(`Could not measure ${file}`);
  return duration;
}
async function hasAudio(file) {
  const { stdout } = await run(ffprobe, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file]);
  return stdout.trim().length > 0;
}
const fmt = (seconds) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;

// ---------- narration ----------
async function synthLine(text) {
  if (DRY) return { file: null, duration: text.split(/\s+/).length / 2.9 + 0.2 };
  const key = hash([text, ttsModel, voice, voiceInstructions]);
  const raw = path.join(voDir, `${key}.mp3`);
  if (!await exists(raw)) {
    const response = await openai.audio.speech.create({ model: ttsModel, voice, input: text, instructions: voiceInstructions, response_format: 'mp3' });
    await writeFile(raw, Buffer.from(await response.arrayBuffer()));
    console.log(`  voice: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`);
  }
  // Trim TTS lead/tail silence, then speed up without changing pitch. GAP sets the pacing between lines.
  const file = path.join(voDir, `${key}-x${voiceSpeed}.wav`);
  if (!await exists(file)) {
    const trim = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05';
    await run(ffmpeg, ['-y', '-i', raw, '-af', `${trim},areverse,${trim},areverse,atempo=${voiceSpeed},aresample=48000`, '-ac', '2', file]);
  }
  return { file, duration: await probe(file) };
}
// Stretches where the clip's own audio is speaking (Hivemind's voice), in clip seconds.
async function detectSpeech(file) {
  const { stderr } = await execFileAsync(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'silencedetect=noise=-40dB:d=0.6', '-f', 'null', '-'], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  const length = await probe(file);
  const speech = []; let from = 0;
  for (const m of stderr.toString().matchAll(/silence_(start|end): ([\d.]+)/g)) {
    const t = Number(m[2]);
    if (m[1] === 'start') { if (from !== null && t - from > 0.5) speech.push([from, t]); from = null; } else from = t;
  }
  if (from !== null && length - from > 0.5) speech.push([from, length]);
  return speech;
}

// For a scene with hiveAfter and detected clip speech, start the clip so Hivemind begins talking right
// after that line, and never let narration overlap any Hivemind speech inside the scene.
async function planHiveHolds(scene, lines) {
  scene.holds = [];
  if (scene.hiveAfter == null || !scene.speech?.length) return;
  const lead = LEAD + lines.slice(0, scene.hiveAfter + 1).reduce((sum, l) => sum + l.duration + GAP, 0) - GAP + HIVE_PAD;
  const manual = process.env.VIDEO_TWITCH_START;
  if (manual !== undefined && manual !== '') scene.clipStart = Number(manual);
  else {
    const hive = scene.speech.find(([s]) => s - lead >= 0);
    scene.clipStart = hive ? hive[0] - lead : 0;
  }
  scene.holds = scene.speech.map(([s, e]) => [s - scene.clipStart, e - scene.clipStart]).filter(([, e]) => e > 0);
}

async function prepareNarration() {
  console.log(DRY ? '  dry run: estimating narration timing (no OpenAI calls)' : `  ${ttsModel}, voice "${voice}", speed x${voiceSpeed}`);
  let sceneStart = 0;
  for (const scene of scenes) {
    const lines = [];
    for (const text of scene.lines) lines.push({ text, ...await synthLine(text) });
    await planHiveHolds(scene, lines);
    let t = LEAD; let end = 0;
    scene.cues = [];
    for (const line of lines) {
      // Push the line past any Hivemind speech it would talk over.
      for (let moved = true; moved;) {
        moved = false;
        for (const [hs, he] of scene.holds) if (t < he + HIVE_PAD - 0.01 && t + line.duration > hs - HIVE_PAD + 0.01) { t = he + HIVE_PAD; moved = true; }
      }
      scene.cues.push({ text: line.text, start: t, duration: line.duration, file: line.file });
      t += line.duration + GAP;
    }
    end = t - GAP + TAIL;
    // Let any Hivemind line that starts inside the scene finish.
    for (const [hs, he] of scene.holds) if (hs < end && he + 0.5 > end) end = he + 0.5;
    scene.duration = Math.max(scene.min || 0, end);
    if (scene.holds.length) console.log(`  ${scene.id}: clip from ${scene.clipStart.toFixed(1)}s, Hivemind speaks at ${scene.holds.filter(([hs]) => hs < scene.duration).map(([hs, he]) => `${hs.toFixed(1)}-${he.toFixed(1)}s`).join(', ') || 'none'}`);
    scene.start = sceneStart;
    sceneStart += scene.duration;
  }
  if (sceneStart >= MAX_SECONDS) throw new Error(`Narration makes the video ${fmt(sceneStart)}; it must stay under 2:58. Raise VIDEO_VOICE_SPEED or shorten lines.`);
  console.log(`  planned length ${fmt(sceneStart)}`);
}
async function buildSceneAudio(scene) {
  const out = path.join(sceneDir, `${scene.id}-vo.wav`);
  const voiced = scene.cues.filter((cue) => cue.file);
  if (!voiced.length) { await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', String(scene.duration), out]); return out; }
  const args = ['-y']; voiced.forEach((cue) => args.push('-i', cue.file));
  const filters = voiced.map((cue, i) => `[${i}:a]adelay=${Math.round(cue.start * 1000)}:all=1[a${i}]`);
  filters.push(`${voiced.map((_c, i) => `[a${i}]`).join('')}amix=inputs=${voiced.length}:normalize=0:duration=longest,apad,atrim=duration=${scene.duration}[out]`);
  await run(ffmpeg, [...args, '-filter_complex', filters.join(';'), '-map', '[out]', '-ar', '48000', '-ac', '2', out]);
  return out;
}

// ---------- subtitles ----------
function wrapCue(text) {
  const words = text.split(/\s+/); const lines = []; let current = '';
  for (const word of words) {
    if (current && `${current} ${word}`.length > 42) { lines.push(current); current = word; } else current = current ? `${current} ${word}` : word;
  }
  if (current) lines.push(current);
  const chunks = []; for (let i = 0; i < lines.length; i += 2) chunks.push(lines.slice(i, i + 2));
  return chunks;
}
function subtitleCues() {
  const cues = [];
  for (const scene of scenes) for (const cue of scene.cues) {
    const chunks = wrapCue(cue.text); const total = chunks.reduce((sum, c) => sum + c.join(' ').length, 0);
    let t = scene.start + cue.start;
    for (const chunk of chunks) {
      const duration = cue.duration * chunk.join(' ').length / total;
      cues.push({ start: t, end: t + duration, lines: chunk }); t += duration;
    }
  }
  // Hold each cue until the next one starts (up to 0.6s) so captions don't flicker during pauses.
  cues.forEach((cue, i) => { const next = cues[i + 1]?.start ?? Infinity; cue.end = Math.min(next - 0.02, cue.end + 0.6); });
  return cues;
}
const srtTime = (s) => { const ms = Math.round(s * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
const assTime = (s) => { const cs = Math.round(s * 100); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
async function writeSubtitles() {
  const cues = subtitleCues();
  await writeFile(srtPath, cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.lines.join('\n')}`).join('\n\n') + '\n', 'utf8');
  // Burned-in style: bold white on a translucent dark box, bottom center, sized for 2160p.
  const ass = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,90,&H00FFFFFF,&H00FFFFFF,&H50100A16,&H50100A16,-1,0,0,0,100,100,0,0,3,24,0,2,240,240,110,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n` +
    cues.map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${c.lines.join('\\N')}`).join('\n') + '\n';
  await writeFile(path.join(buildDir, 'subtitles.ass'), ass, 'utf8');
}

// ---------- motion graphics (rendered frame by frame at 4K) ----------
const shell = (body, script, css = '') => `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1920px;height:1080px;overflow:hidden;background:#0b0912;color:#f6f4ff;font-family:Inter,"Segoe UI",system-ui,Arial,sans-serif}
.bg{position:absolute;inset:0;background:radial-gradient(1100px 700px at 12% -5%,rgba(145,70,255,.30),transparent 60%),radial-gradient(1000px 760px at 105% 105%,rgba(255,77,152,.20),transparent 60%),#0b0912}
.abs{position:absolute}
.kicker{font-size:22px;letter-spacing:.24em;font-weight:800;color:#ff4d98;text-transform:uppercase}
.grad{background:linear-gradient(90deg,#ff4d98,#a58bff);-webkit-background-clip:text;background-clip:text;color:transparent}
.card{background:rgba(23,19,38,.88);border:1.5px solid rgba(255,255,255,.12);border-radius:24px}
.orb{border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffd6ec,#ff4d98 45%,#7a2bd6 82%);box-shadow:0 0 120px rgba(255,77,152,.55)}
.pill{display:inline-flex;align-items:center;gap:12px;padding:12px 24px;border-radius:999px;font-weight:800;font-size:26px;background:rgba(255,255,255,.07);border:1.5px solid rgba(255,255,255,.14)}
${css}</style></head><body><div class="bg"></div>${body}<script>
const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
const ease=(x)=>{x=clamp(x);return x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2};
const out=(x)=>1-Math.pow(1-clamp(x),3);
const prog=(t,a,d)=>ease((t-a)/d);
const lerp=(a,b,p)=>a+(b-a)*p;
const $=(s)=>document.querySelector(s); const $$=(s)=>[...document.querySelectorAll(s)];
function rng(seed){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const show=(el,p,dy=30)=>{el.style.opacity=p;el.style.transform='translateY('+((1-p)*dy)+'px)'};
let D={};window.setup=(d)=>{D=d;if(window.init)init()};
${script}
</script></body></html>`;

const motion = {
  flood: () => shell(`
<div class="abs" style="left:150px;top:210px;width:900px">
  <div class="kicker">Live chat, unfiltered</div>
  <h1 id="h0" style="font-size:104px;line-height:1;font-weight:900;margin-top:26px">Boss fight.</h1>
  <h1 id="h1" style="font-size:72px;line-height:1.05;font-weight:900;margin-top:30px"><span id="rate">0</span> messages<br>a minute.</h1>
  <h1 id="h2" class="grad" style="font-size:72px;line-height:1.05;font-weight:900;margin-top:30px;padding-bottom:8px">You can read<br>maybe three.</h1>
</div>
<div class="card abs" style="left:1130px;top:60px;width:650px;height:860px;overflow:hidden">
  <div style="padding:26px 30px;border-bottom:1.5px solid rgba(255,255,255,.1);display:flex;justify-content:space-between;align-items:center;background:#171326;position:relative;z-index:2"><b style="font-size:24px;letter-spacing:.12em">STREAM CHAT</b><span class="pill" style="font-size:20px;padding:8px 16px"><span style="width:12px;height:12px;border-radius:50%;background:#ff5f54"></span>LIVE</span></div>
  <div id="list" class="abs" style="left:0;right:0;top:90px"></div>
</div>`, `
const users=['xXSlayerXx','mochi_bun','tankmain42','lurk_king','pixelpanda','GG_gramps','nightowl','captain_chaos','sweatlord','bean_juice','frogfan','kiwi_kat'];
const colors=['#ff4d98','#75b9ee','#ffe15b','#64e6bd','#a58bff','#ff8a5b'];
const texts=['GO LEFT GO LEFT','dodge the slam!!','use fire, it is weak to fire','heal first pls','LETSGOOO','why is he standing there','RIGHT SIDE IS SAFE','KEKW','phase 2 incoming','he has no potions','left door left door','jump NOW','Pog','check the map','this boss is free','are we fr','parry it!!','we are so back','loot first then boss','left at the statue'];
const ROW=58,N=240;const r=rng(7);
function init(){const list=$('#list');for(let i=0;i<N;i++){const d=document.createElement('div');d.className='row';d.style.cssText='height:'+ROW+'px;padding:0 30px;display:flex;align-items:center;font-size:25px;white-space:nowrap;overflow:hidden';const u=users[Math.floor(r()*users.length)];d.innerHTML='<b style="color:'+colors[Math.floor(r()*colors.length)]+';margin-right:12px">'+u+':</b><span>'+texts[Math.floor(r()*texts.length)]+'</span>';list.appendChild(d)}}
function offset(t){const stop=D.cues[2]+0.3;const tt=Math.min(t,stop);let o=0;for(let s=0;s<tt;s+=1/30)o+=lerp(70,520,clamp(s/(D.cues[1]+1)))/30;if(t>stop)o+=60*out((t-stop)/0.8);return o}
function renderAt(t){const o=offset(t);$('#list').style.transform='translateY('+(-o+700)+'px)';
show($('#h0'),prog(t,D.cues[0],0.5));show($('#h1'),prog(t,D.cues[1],0.5));show($('#h2'),prog(t,D.cues[2],0.5));
if(t>D.cues[1])$('#h0').style.opacity=0.45;if(t>D.cues[2])$('#h1').style.opacity=0.45;
$('#rate').textContent=Math.round(lerp(40,640,clamp((t-D.cues[1]+0.6)/2.2))).toLocaleString('en-US');
const focus=prog(t,D.cues[2]+0.3,0.6);const top=Math.floor((o-700)/ROW);const pick=[top+4,top+8,top+12];
$$('.row').forEach((row,i)=>{const hit=pick.includes(i);row.style.opacity=hit?1:1-0.8*focus;row.style.filter=hit?'none':'blur('+(3*focus)+'px)';row.style.background=hit&&focus>0?'rgba(255,77,152,'+(0.22*focus)+')':'none'})}`),

  title: () => shell(`
<div id="dots"></div>
<div class="orb abs" id="orb" style="left:840px;top:250px;width:240px;height:240px"></div>
<div class="abs" style="left:0;right:0;top:560px;text-align:center">
  <div id="name" style="font-size:150px;font-weight:900;letter-spacing:.06em">HIVEMIND</div>
  <div id="tag" style="font-size:58px;font-weight:800;margin-top:10px"><span>1,000 voices.</span> <span class="grad">One mind.</span></div>
</div>`, `
const N=170;const pts=[];
function init(){const r=rng(11);const cols=['#ff4d98','#75b9ee','#ffe15b','#64e6bd','#a58bff'];for(let i=0;i<N;i++){const d=document.createElement('div');d.className='abs';const s=8+r()*14;d.style.cssText='width:'+s+'px;height:'+s+'px;border-radius:50%;background:'+cols[i%5]+';box-shadow:0 0 18px '+cols[i%5];$('#dots').appendChild(d);pts.push({d,x:r()*1920,y:r()*1080,s,delay:r()*0.6})}}
function renderAt(t){pts.forEach(p=>{const q=ease((t-p.delay)/1.7);p.d.style.left=lerp(p.x,960,q)-p.s/2+'px';p.d.style.top=lerp(p.y,370,q)-p.s/2+'px';p.d.style.opacity=1-clamp((q-0.85)/0.15)});
const o=out((t-1.3)/0.7);$('#orb').style.transform='scale('+(o*(1+0.04*Math.sin(t*4)))+')';$('#orb').style.opacity=o;
show($('#name'),prog(t,1.6,0.6),40);show($('#tag'),prog(t,D.cues[1],0.6),30)}`),

  how: () => shell(`
<div class="abs" style="left:150px;top:80px"><div class="kicker">How it works</div></div>
<div class="abs" id="stages" style="left:150px;top:140px;width:1620px;display:flex;gap:20px"></div>
<div class="card abs" style="left:150px;top:330px;width:1620px;height:550px;overflow:hidden">
  <div class="abs" id="p0" style="inset:0"></div><div class="abs" id="p2" style="inset:0"></div><div class="abs" id="p3" style="inset:0"></div><div class="abs" id="p4" style="inset:0"></div><div class="abs" id="p5" style="inset:0"></div>
</div>`, `
const stages=[['01','Twitch chat','EventSub'],['02','Moderation','OpenAI'],['03','Embeddings','cluster by meaning'],['04',D_MODEL,'merge · mood · line'],['05','Voice','text to speech']];
const bubbles=[['mochi_bun','go left!!',0],['tankmain42','take the left door',0],['sweatlord','you are garbage, uninstall',1],['pixelpanda','right side is faster',0],['lurk_king','left at the statue',0],['frogfan','check the map first',0],['bean_juice','streamer is trash lol',1],['nightowl','LEFT. trust.',0]];
const dots=[];
function init(){
 stages.forEach(s=>{const d=document.createElement('div');d.className='card stage';d.style.cssText='flex:1;padding:22px 24px;height:150px';d.innerHTML='<div style="color:#ff4d98;font-weight:800;font-size:20px;letter-spacing:.2em">'+s[0]+'</div><div style="font-size:31px;font-weight:900;margin-top:8px">'+s[1]+'</div><div style="font-size:20px;color:#b7b4cb;margin-top:6px">'+s[2]+'</div>';$('#stages').appendChild(d)});
 $('#p0').innerHTML='<div id="shield" class="abs pill" style="right:40px;top:36px;color:#64e6bd">OpenAI moderation</div>'+bubbles.map((b,i)=>'<div class="abs bub" style="left:'+(60+(i%2)*560)+'px;top:'+(40+Math.floor(i/2)*134)+'px;padding:22px 28px;border-radius:20px;background:rgba(255,255,255,.06);border:1.5px solid rgba(255,255,255,.12);font-size:30px;white-space:nowrap"><b style="color:#a58bff">'+b[0]+':</b> <span class="tx">'+b[1]+'</span></div>').join('');
 const chips=['go left!!','take the left door','left at the statue'];
 $('#p2').innerHTML=chips.map((c,i)=>'<div class="abs pill chip" style="left:70px;top:'+(110+i*130)+'px;font-size:34px">“'+c+'”</div>').join('')+'<div id="merged" class="abs pill" style="left:70px;top:240px;font-size:44px;padding:20px 34px;border-color:#ff4d98;background:rgba(255,77,152,.18)">LEFT <span style="color:#b7b4cb;font-size:28px">× 3 messages</span></div><div id="dots" class="abs" style="left:720px;top:40px;width:860px;height:520px"></div>';
 const r=rng(3);const centers=[[180,140,'#ff4d98'],[620,170,'#75b9ee'],[400,400,'#ffe15b']];
 for(let i=0;i<48;i++){const c=centers[i%3];const d=document.createElement('div');d.className='abs';d.style.cssText='width:22px;height:22px;border-radius:50%;background:'+c[2]+';box-shadow:0 0 16px '+c[2];$('#dots').appendChild(d);dots.push({d,x:r()*840,y:r()*500,cx:c[0]+(r()-.5)*150,cy:c[1]+(r()-.5)*120})}
 const bars=[['Go left',54,'#ff4d98'],['Fight the boss now',31,'#75b9ee'],['Check the map',15,'#ffe15b']];
 $('#p3').innerHTML=bars.map((b,i)=>'<div class="abs" style="left:70px;top:'+(60+i*120)+'px;width:860px"><div style="display:flex;justify-content:space-between;font-size:30px;font-weight:800"><span>'+b[0]+'</span><span class="pct">0%</span></div><div style="height:26px;border-radius:13px;background:rgba(255,255,255,.08);margin-top:12px;overflow:hidden"><div class="bar" data-v="'+b[1]+'" style="height:100%;width:0;background:'+b[2]+';border-radius:13px"></div></div></div>').join('')+'<div id="mood" class="abs pill" style="left:70px;top:430px;font-size:30px;border-color:#ff4d98;color:#ff4d98">● MOOD: HYPED</div><div class="abs card" style="left:1000px;top:60px;width:560px;padding:32px;background:rgba(255,77,152,.12);border-color:rgba(255,77,152,.5)"><div style="font-size:20px;color:#ff4d98;font-weight:800;letter-spacing:.18em">THE HIVE SAYS</div><div id="line" style="font-size:36px;font-weight:800;margin-top:14px;min-height:140px"></div></div><div class="abs" style="left:1000px;top:420px;width:560px;font-size:24px;color:#b7b4cb">Up to 10 clusters in, at most 3 intents out.</div>';
 $('#p4').innerHTML='<div class="orb abs" id="vorb" style="left:120px;top:150px;width:300px;height:300px"></div><div id="wave" class="abs" style="left:520px;top:150px;width:980px;height:300px;display:flex;align-items:center;gap:8px"></div><div class="abs pill" style="left:520px;top:480px">'+D_TTS+'</div>';
 for(let i=0;i<60;i++){const b=document.createElement('div');b.className='wb';b.style.cssText='flex:1;border-radius:6px;background:linear-gradient(#ff4d98,#a58bff);height:10px';$('#wave').appendChild(b)}
 $('#p5').innerHTML='<div class="abs" style="left:0;right:0;top:110px;display:flex;justify-content:center;gap:34px">'+['1 moderation call','1 embeddings call','1 chat call'].map(x=>'<div class="pill big" style="font-size:40px;padding:26px 40px;border-color:#a58bff">'+x+'</div>').join('')+'</div><div id="perw" class="abs" style="left:0;right:0;top:330px;text-align:center;font-size:52px;font-weight:900">per window. <span class="grad">Never per message.</span></div>';
}
function renderAt(t){const c=D.cues;const stage=t<c[1]?0:t<c[2]?1:t<c[3]?2:t<c[4]?3:t<c[5]?4:5;
 $$('.stage').forEach((el,i)=>{const on=stage===5||i===stage;const seen=i<=stage;el.style.opacity=(on?1:seen?0.55:0.3)*prog(t,0.15+i*0.12,0.5);el.style.borderColor=on?'#ff4d98':'rgba(255,255,255,.12)';el.style.boxShadow=on?'0 0 40px rgba(255,77,152,.35)':'none';el.style.transform='translateY('+(on?-6:0)+'px)'});
 const fadeIn=(start)=>clamp((t-start)/0.35);
 $('#p0').style.opacity=stage<=1?1:1-fadeIn(c[2]);$('#p2').style.opacity=stage===2?fadeIn(c[2]):0;$('#p3').style.opacity=stage===3?fadeIn(c[3]):0;$('#p4').style.opacity=stage===4?fadeIn(c[4]):0;$('#p5').style.opacity=stage===5?fadeIn(c[5]):0;
 $$('.bub').forEach((b,i)=>{const p=prog(t,0.3+i*0.18,0.4);let op=p,sc=1;if(bubbles[i][2]){const k=prog(t,c[1]+0.9,0.6);b.style.borderColor=k>0?'rgba(255,95,84,'+(0.4+0.6*k)+')':'rgba(255,255,255,.12)';b.style.background=k>0?'rgba(255,95,84,'+(0.18*k)+')':'rgba(255,255,255,.06)';b.querySelector('.tx').style.textDecoration=k>0.5?'line-through':'none';const gone=prog(t,c[1]+2.4,0.6);op=Math.min(op,1-gone);sc=1-0.2*gone}b.style.opacity=op;b.style.transform='translateY('+((1-p)*20)+'px) scale('+sc+')'});
 show($('#shield'),prog(t,c[1]+0.2,0.4),10);
 const m=prog(t,c[2]+1.6,0.9);$$('.chip').forEach((ch,i)=>{const p=prog(t,c[2]+0.2+i*0.25,0.4);ch.style.opacity=Math.min(p,1-clamp((m-0.7)/0.3));ch.style.transform='translateY('+(lerp(0,240-(110+i*130),m)+(1-p)*16)+'px)'});
 show($('#merged'),clamp((m-0.75)/0.25),0);
 const q=prog(t,c[2]+0.8,1.8);dots.forEach(d=>{d.d.style.left=lerp(d.x,d.cx,q)+'px';d.d.style.top=lerp(d.y,d.cy,q)+'px'});
 $$('.bar').forEach((b,i)=>{const p=prog(t,c[3]+0.3+i*0.2,0.9);b.style.width=(p*b.dataset.v)+'%';$$('.pct')[i].textContent=Math.round(p*b.dataset.v)+'%'});
 show($('#mood'),prog(t,c[3]+1.2,0.4),10);const L='“Chat has spoken: LEFT door. Now. Trust the statue.”';$('#line').textContent=L.slice(0,Math.floor(clamp((t-c[3]-1.6)/2.2)*L.length));
 $$('.wb').forEach((b,i)=>{const a=stage===4?1:0;b.style.height=(12+a*(0.5+0.5*Math.sin(t*9+i*0.7))*(0.4+0.6*Math.abs(Math.sin(i*1.7+t*3)))*260)+'px'});$('#vorb').style.transform='scale('+(1+0.05*Math.sin(t*8))+')';
 $$('.big').forEach((p,i)=>show(p,prog(t,c[5]+0.2+i*0.25,0.4),20));show($('#perw'),prog(t,c[5]+1.2,0.5),20)}`).replace(/D_MODEL/g, JSON.stringify(chatModelLabel)).replace(/D_TTS/g, JSON.stringify(ttsModel)),

  codex: () => shell(`
<div class="abs" style="left:150px;top:150px;width:700px">
  <div class="kicker">Built with OpenAI Codex</div>
  <h1 style="font-size:84px;line-height:1.02;font-weight:900;margin-top:26px">One spec.<br><span class="grad">One prompt<br>at a time.</span></h1>
  <div style="display:flex;gap:16px;margin-top:46px;flex-wrap:wrap"><span class="pill doc">SPEC.md</span><span class="pill doc">AGENTS.md</span><span class="pill doc">PROMPTS.md</span></div>
  <div id="note" class="card" style="margin-top:46px;padding:28px 32px;border-color:#ff4d98;background:rgba(255,77,152,.12);font-size:28px;font-weight:700;line-height:1.35"></div>
</div>
<div class="abs" id="log" style="left:960px;top:120px;width:820px"></div>`, `
function init(){$('#log').innerHTML='<div style="font-size:22px;color:#b7b4cb;font-weight:800;letter-spacing:.2em;margin-bottom:22px">REAL COMMIT HISTORY · '+D.repo+'</div>'+D.commits.map(c=>'<div class="card cm" style="padding:20px 26px;margin-bottom:16px;display:flex;gap:22px;align-items:center"><code style="color:#a58bff;font-size:24px;font-weight:700">'+c.hash+'</code><span style="font-size:27px;font-weight:700">'+c.subject+'</span></div>').join('')}
function renderAt(t){const c=D.cues;$$('.doc').forEach((d,i)=>show(d,prog(t,c[1]+0.2+i*0.3,0.4),16));
 const n=D.commits.length;const a=c[1]+0.4,b=c[4]+1;$$('.cm').forEach((el,i)=>{show(el,prog(t,a+(b-a)*i/n,0.45),24);const hot=(D.commits[i].hot==='merge'&&t>c[3])||(D.commits[i].hot==='rooms'&&t>c[4]);el.style.borderColor=hot?'#ff4d98':'rgba(255,255,255,.12)';el.style.boxShadow=hot?'0 0 40px rgba(255,77,152,.4)':'none'});
 const note=t>c[4]?'Then: multi-room Twitch login, a public sandbox, and a Render deploy.':t>c[3]?'Bug found in live testing: one opinion split into three bars. Codex added an AI merge step.':t>c[2]?'Server · Twitch OAuth + EventSub · overlay · dashboard · simulator · tests.':'';
 const nk=t>c[4]?c[4]:t>c[3]?c[3]:c[2];$('#note').textContent=note;show($('#note'),note?prog(t,nk+0.1,0.4):0,16)}`),

  outro: () => shell(`
<div class="orb abs" id="orb" style="left:880px;top:110px;width:160px;height:160px"></div>
<div class="abs" style="left:0;right:0;top:310px;text-align:center">
  <div id="name" style="font-size:120px;font-weight:900;letter-spacing:.06em">HIVEMIND</div>
  <div style="display:flex;justify-content:center;gap:26px;margin-top:40px">
    <span class="pill st" style="font-size:32px;padding:20px 32px">1 · Log in with Twitch</span><span class="pill st" style="font-size:32px;padding:20px 32px">2 · Paste one link into OBS</span><span class="pill st" style="font-size:32px;padding:20px 32px;border-color:#ff4d98">3 · Chat speaks as one</span>
  </div>
  <div id="url" style="font-size:54px;font-weight:900;margin-top:70px" class="grad">${baseUrl.replace(/^https?:\/\//, '')}</div>
  <div id="repo" style="font-size:30px;color:#b7b4cb;margin-top:22px">${repoUrl.replace(/^https?:\/\//, '')} · Built with OpenAI Codex</div>
</div>`, `
function renderAt(t){const c=D.cues;const o=out(t/0.6);$('#orb').style.transform='scale('+(o*(1+0.05*Math.sin(t*4)))+')';show($('#name'),prog(t,0.1,0.5),30);
$$('.st').forEach((s,i)=>show(s,prog(t,c[0]+0.2+i*0.45,0.4),20));show($('#url'),prog(t,c[1],0.5),20);show($('#repo'),prog(t,c[2],0.5),20)}`)
};

const cardHtml = (title, subtitle) => shell(`<div class="abs" style="left:0;right:0;top:380px;text-align:center"><div class="kicker">Footage needed</div><div style="font-size:76px;font-weight:900;margin-top:26px">${title}</div><div style="font-size:34px;color:#b7b4cb;margin-top:24px">${subtitle}</div></div>`, 'function renderAt(){}');
const tagHtml = (label, sub) => `<!doctype html><style>*{margin:0;box-sizing:border-box}html,body{background:transparent;width:1920px;height:1080px;font-family:Inter,"Segoe UI",system-ui,Arial,sans-serif}.t{position:absolute;left:56px;top:52px;display:flex;align-items:center;gap:14px;padding:14px 26px;border-radius:999px;background:rgba(14,10,24,.82);border:2px solid rgba(255,77,152,.7);color:#fff;font-weight:900;font-size:28px;letter-spacing:.12em;box-shadow:0 10px 40px rgba(0,0,0,.45)}.d{width:14px;height:14px;border-radius:50%;background:#ff4d98;box-shadow:0 0 14px #ff4d98}.s{font-weight:600;letter-spacing:0;color:#d9d3ea;font-size:24px;margin-left:8px}</style><div class="t"><span class="d"></span>${label}${sub ? `<span class="s">${sub}</span>` : ''}</div>`;

const frameBgHtml = () => shell(`<div class="abs" style="left:${FRAME.x / 2}px;top:${FRAME.y / 2}px;width:${FRAME.w / 2}px;height:${FRAME.h / 2}px;border-radius:28px;background:#000;box-shadow:0 30px 120px rgba(0,0,0,.65),0 0 0 2px rgba(255,255,255,.14),0 0 90px rgba(145,70,255,.30)"></div>`, 'function renderAt(){}');
const frameMaskHtml = () => `<!doctype html><style>*{margin:0}html,body{background:#000;width:${FRAME.w / 2}px;height:${FRAME.h / 2}px;overflow:hidden}div{width:100%;height:100%;border-radius:28px;background:#fff}</style><div></div>`;

async function renderMotion(browser, name, html, data, from, to) {
  const file = path.join(motionDir, `${name}-${hash([html, data, from, to, W])}.mp4`);
  if (await exists(file)) { console.log(`  ${name}: cached`); return file; }
  const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: W / VW });
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate((d) => window.setup(d), data);
    await page.evaluate(() => document.fonts.ready);
    const temp = `${file}.part`;
    const encoder = spawn(ffmpeg, ['-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', '-f', 'mp4', temp], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = ''; encoder.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-3000); });
    const done = once(encoder, 'close');
    const frames = Math.max(1, Math.round((to - from) * FPS));
    const started = Date.now();
    for (let f = 0; f < frames; f++) {
      await page.evaluate((t) => window.renderAt(t), from + f / FPS);
      let jpeg;
      for (let attempt = 1; !jpeg; attempt++) {
        try { jpeg = await page.screenshot({ type: 'jpeg', quality: 93 }); }
        catch (error) { if (attempt >= 4) throw error; await page.waitForTimeout(500 * attempt); }
      }
      if (!encoder.stdin.write(jpeg)) await once(encoder.stdin, 'drain');
      if (f % 150 === 149) process.stdout.write(`  ${name}: ${f + 1}/${frames} frames\r`);
    }
    encoder.stdin.end();
    const [code] = await done;
    if (code !== 0) throw new Error(`ffmpeg motion encode failed: ${stderr}`);
    await rename(temp, file);
    console.log(`  ${name}: ${frames} frames in ${((Date.now() - started) / 1000).toFixed(0)}s          `);
    return file;
  } finally { await page.close(); }
}
async function renderStill(browser, name, html, transparent = false, size = { width: VW, height: VH }) {
  const file = path.join(motionDir, `${name}-${hash([html, W, size])}.png`);
  if (await exists(file)) return file;
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: W / VW });
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => { window.setup?.({ cues: [] }); window.renderAt?.(0); });
    await page.screenshot({ path: file, omitBackground: transparent });
  } finally { await page.close(); }
  return file;
}

// ---------- live-site recordings ----------
async function waitForSite() {
  const deadline = Date.now() + 150_000; let last = 'no response';
  console.log(`  waking ${baseUrl}`);
  while (Date.now() < deadline) {
    try { const r = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(12_000) }); if (r.ok) return; last = `HTTP ${r.status}`; }
    catch (error) { last = error instanceof Error ? error.message : String(error); }
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  throw new Error(`Live site did not wake: ${last}`);
}
async function api(route, body) {
  const r = await fetch(`${baseUrl}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(20_000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${route} failed: ${r.status} ${data.error || ''}`.trim());
  return data;
}
async function countHiveUpdates(page) {
  await page.addInitScript(() => {
    const Original = window.WebSocket;
    window.__hive = 0;
    window.WebSocket = function (url, protocols) {
      const ws = protocols === undefined ? new Original(url) : new Original(url, protocols);
      ws.addEventListener('message', (event) => { try { if (JSON.parse(event.data).type === 'hive_update') window.__hive++; } catch {} });
      return ws;
    };
    window.WebSocket.prototype = Original.prototype; Object.assign(window.WebSocket, Original);
  });
}
const updates = (page) => page.evaluate(() => window.__hive || 0);
const waitUpdates = (page, n, ms) => page.waitForFunction((target) => (window.__hive || 0) >= target, n, { timeout: ms }).then(() => true, () => false);

async function recordSite(browser) {
  const markersFile = path.join(recDir, 'markers.json');
  if (REUSE) {
    const markers = JSON.parse(await readFile(markersFile, 'utf8').catch(() => { throw new Error('No recordings to reuse; run without --reuse first.'); }));
    console.log('  reusing the last live-site recordings');
    return markers;
  }
  await waitForSite();
  // One sandbox room for every recording, so a build never fills the 10-room limit.
  const { roomId } = await api('/api/sandbox');
  await api(`/api/dashboard/${roomId}/settings`, { windowSeconds: 10 }).catch(() => undefined);
  console.log(`  recording in sandbox room ${roomId}`);
  const markers = {};
  const record = async (name, fn) => {
    const context = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1, recordVideo: { dir: recDir, size: { width: VW, height: VH } } });
    await context.addInitScript((id) => localStorage.setItem('hivemind-sandbox-room', id), roomId);
    const page = await context.newPage(); const t0 = Date.now(); const m = {};
    const mark = (key) => { m[key] = (Date.now() - t0) / 1000; };
    try { await fn(page, mark); }
    finally { await context.close(); }
    const file = path.join(recDir, `${name}.webm`); await rm(file, { force: true });
    await page.video().saveAs(file); await page.video().delete();
    m.file = file; m.length = await probe(file); markers[name] = m;
    console.log(`  recorded ${name}.webm (${m.length.toFixed(1)}s)`);
  };

  await record('landing', async (page, mark) => {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByText(/your room is live/i).waitFor({ timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(1800);
    await page.evaluate(() => document.querySelector('#sandbox')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    await page.waitForTimeout(1800); mark('sandbox');
    await page.locator('#message').click();
    await page.locator('#message').pressSequentially('boss is weak to fire, use fire!', { delay: 55 });
    await page.keyboard.press('Enter'); await page.waitForTimeout(900);
    await page.locator('.scenario[data-scenario="boss-fight"]').click(); mark('scenario');
    await page.waitForTimeout(3000);
  });

  await record('overlay', async (page, mark) => {
    await countHiveUpdates(page);
    await page.goto(`${baseUrl}/overlay/${roomId}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    // The overlay is transparent for OBS; give the browser recording a dark stream-like backdrop.
    await page.addStyleTag({ content: 'html,body{background:radial-gradient(1200px 800px at 75% 15%,#3b2063 0%,transparent 60%),radial-gradient(1000px 700px at 5% 95%,#1b2d5e 0%,transparent 60%),#0d0a17 !important}' });
    await page.waitForTimeout(1500);
    const n0 = await updates(page);
    if (await waitUpdates(page, n0 + 1, 60_000)) mark('firstUpdate'); else console.warn('  no hive_update within 60s (is OpenAI configured on the site?)');
    if (await waitUpdates(page, n0 + 2, 30_000)) mark('secondUpdate');
    await page.waitForTimeout(3500);
    mark('events');
    for (const kind of ['raid', 'sub', 'cheer']) {
      await page.evaluate(async ({ id, k }) => { await fetch(`/api/sandbox/${id}/event`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: k }) }); }, { id: roomId, k: kind });
      await page.waitForTimeout(5000);
    }
    await page.waitForTimeout(1500);
  });

  await record('dashboard', async (page, mark) => {
    await api(`/api/sandbox/${roomId}/scenario`, { scenario: 'boss-fight' }).catch(() => undefined);
    await page.goto(`${baseUrl}/dashboard/${roomId}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.locator('#question').waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    const before = await page.locator('#response-line').textContent();
    mark('ask');
    await page.locator('#question').click();
    await page.locator('#question').pressSequentially('Boss or loot first?', { delay: 60 });
    await page.locator('#ask-button').click();
    const answered = await page.waitForFunction((prev) => { const t = document.querySelector('#response-line')?.textContent || ''; return t !== prev && !/listening/i.test(t); }, before, { timeout: 45_000 }).then(() => true, () => false);
    if (answered) mark('answer'); else console.warn('  dashboard answer did not arrive within 45s');
    await page.waitForTimeout(4500);
  });
  await writeFile(markersFile, JSON.stringify(markers, null, 2));
  return markers;
}

// ---------- scene assembly ----------
const clipPart = (file, start, duration, extra = {}) => ({ file, start: Math.max(0, start), duration, ...extra });
const imagePart = (file, duration) => ({ file, image: true, start: 0, duration });
const frameStills = {};
// Each footage part is encoded on its own and the parts are joined without re-encoding. Building them in
// one filter graph makes ffmpeg buffer the later parts' 4K frames in memory (it ran out of RAM).
async function buildPart(scene, part, i, last, file) {
  const args = ['-y']; const filters = []; let n = 0;
  const d = part.duration.toFixed(3);
  const timing = `fps=${FPS},tpad=stop_mode=clone:stop_duration=${d},trim=duration=${d},setpts=PTS-STARTPTS`;
  if (part.image) args.push('-loop', '1', '-framerate', String(FPS), '-t', String(part.duration + 0.5), '-i', part.file);
  else args.push('-ss', part.start.toFixed(3), '-i', part.file);
  n++;
  const crop = part.crop ? `crop=${part.crop},` : '';
  if (!part.framed) filters.push(`[0:v]${crop}scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x0b0912,setsar=1,${timing}[v]`);
  else {
    args.push('-loop', '1', '-framerate', String(FPS), '-t', String(part.duration + 0.5), '-i', frameStills.bg); const bg = n++;
    args.push('-loop', '1', '-framerate', String(FPS), '-t', String(part.duration + 0.5), '-i', frameStills.mask); const mask = n++;
    filters.push(
      `[0:v]${crop}scale=${FRAME.w}:${FRAME.h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${FRAME.w}:${FRAME.h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,${timing},format=rgba[f]`,
      `[${mask}:v]format=gray,scale=${FRAME.w}:${FRAME.h},${timing}[m]`, '[f][m]alphamerge[fa]',
      `[${bg}:v]scale=${W}:${H},setsar=1,${timing},format=rgba[b]`, `[b][fa]overlay=${FRAME.x}:${FRAME.y}:format=auto[v]`);
  }
  let v = 'v';
  if (i === 0 && scene.tagFile) {
    args.push('-loop', '1', '-framerate', String(FPS), '-t', String(part.duration + 0.5), '-i', scene.tagFile);
    const out = Math.max(0.9, Math.min(4.5, part.duration - 0.8)).toFixed(2);
    filters.push(`[${n++}:v]format=rgba,fade=in:st=0.4:d=0.4:alpha=1,fade=out:st=${out}:d=0.4:alpha=1[tag]`, `[v][tag]overlay=0:0:format=auto:shortest=1[vt]`);
    v = 'vt';
  }
  const fades = [i === 0 ? `fade=in:st=0:d=${FADE}` : '', last ? `fade=out:st=${(part.duration - FADE).toFixed(3)}:d=${FADE}` : ''].filter(Boolean);
  filters.push(`[${v}]${[...fades, 'format=yuv420p'].join(',')}[vout]`);
  await run(ffmpeg, [...args, '-filter_complex', filters.join(';'), '-map', '[vout]', '-an', '-t', d, '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '15', '-pix_fmt', 'yuv420p', file]);
}
async function buildScene(scene, index) {
  const name = `${String(index + 1).padStart(2, '0')}-${scene.id}`;
  const out = path.join(sceneDir, `${name}.mkv`);
  const vo = await buildSceneAudio(scene);
  const total = scene.parts.reduce((sum, p) => sum + p.duration, 0);
  scene.parts[scene.parts.length - 1].duration += scene.duration - total; // absorb rounding
  const partFiles = [];
  for (const [i, part] of scene.parts.entries()) {
    const file = path.join(sceneDir, `${name}-part${i + 1}.mkv`);
    await buildPart(scene, part, i, i === scene.parts.length - 1, file);
    partFiles.push(file);
  }
  let video = partFiles[0];
  if (partFiles.length > 1) {
    const list = path.join(sceneDir, `${name}-parts.txt`);
    await writeFile(list, partFiles.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n');
    video = path.join(sceneDir, `${name}-video.mkv`);
    await run(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', video]);
  }
  const args = ['-y', '-i', video, '-i', vo];
  const native = scene.parts.find((p) => p.nativeAudio);
  let audio = '[1:a]anull[aout]';
  if (native) {
    const offset = scene.parts.slice(0, scene.parts.indexOf(native)).reduce((sum, p) => sum + p.duration, 0);
    args.push('-ss', native.start.toFixed(3), '-i', native.file);
    // Full volume while Hivemind speaks (the narration pauses there), quiet under the narration otherwise.
    const holds = (native.holds || []).map(([a, b]) => `between(t,${(a - offset - 0.2).toFixed(2)},${(b - offset + 0.2).toFixed(2)})`);
    const level = holds.length ? `volume='if(${holds.join('+')},1,0.3)':eval=frame` : 'volume=0.3';
    audio = `[2:a]atrim=duration=${native.duration.toFixed(3)},asetpts=PTS-STARTPTS,${level},aresample=48000,adelay=${Math.round(offset * 1000)}:all=1[amb];[1:a][amb]amix=inputs=2:normalize=0:duration=first[aout]`;
  }
  await run(ffmpeg, [...args, '-filter_complex', audio, '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', '-t', scene.duration.toFixed(3), out]);
  return out;
}

async function commitHistory() {
  try {
    const { stdout } = await run('git', ['log', '--reverse', '--format=%h|%s', 'HEAD']);
    return stdout.trim().split('\n').map((line) => { const [h, ...rest] = line.split('|'); return { hash: h, subject: rest.join('|') }; })
      .filter((c) => !/readme|video|demo|initial commit/i.test(c.subject)).slice(0, 7)
      .map((c) => ({ ...c, hot: /merge/i.test(c.subject) ? 'merge' : /multi-tenant|multi-room|sandbox/i.test(c.subject) ? 'rooms' : '' }));
  } catch { return []; }
}

async function main() {
  if (!ffmpeg || !ffprobe) throw new Error('ffmpeg-static / ffprobe-static did not resolve a binary.');
  if (!DRY && !process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for the voiceover (or run with --dry).');
  await Promise.all([voDir, recDir, motionDir, sceneDir, outDir, clipsDir].map((dir) => mkdir(dir, { recursive: true })));
  const started = Date.now();
  console.log('1/5 Narration');
  const twitch = path.join(clipsDir, 'twitch.mp4');
  const twitchScene = scenes.find((s) => s.id === 'twitch');
  if (await exists(twitch) && await hasAudio(twitch)) twitchScene.speech = await detectSpeech(twitch);
  await prepareNarration();
  await writeSubtitles();
  const browser = await chromium.launch({ headless: HEADLESS });
  try {
    console.log('2/5 Live site');
    const rec = NO_SITE ? null : await recordSite(browser);
    if (NO_SITE) console.log('  skipped (--no-site)');
    console.log('3/5 Motion graphics (4K, frame by frame)');
    const S = Object.fromEntries(scenes.map((s) => [s.id, s]));
    const data = (scene, extra = {}) => ({ duration: scene.duration, cues: scene.cues.map((c) => c.start), ...extra });
    const motionPart = async (scene, kind, from = 0, to = scene.duration, extra = {}) => ({ file: await renderMotion(browser, kind, motion[kind](), data(scene, extra), from, to), start: 0, duration: to - from });
    const card = (name, title, sub) => renderStill(browser, `card-${name}`, cardHtml(title, sub));
    frameStills.bg = await renderStill(browser, 'frame-bg', frameBgHtml());
    frameStills.mask = await renderStill(browser, 'frame-mask', frameMaskHtml(), false, { width: FRAME.w / 2, height: FRAME.h / 2 });
    for (const scene of scenes) if (scene.tag) scene.tagFile = await renderStill(browser, `tag-${scene.id}`, tagHtml(scene.tag, scene.sub), true);

    S.cold.parts = [await motionPart(S.cold, 'flood')];
    S.title.parts = [await motionPart(S.title, 'title')];
    S.how.parts = [await motionPart(S.how, 'how')];
    S.outro.parts = [await motionPart(S.outro, 'outro')];

    if (await exists(twitch)) S.twitch.parts = [clipPart(twitch, S.twitch.clipStart ?? (Number(process.env.VIDEO_TWITCH_START) || 0), S.twitch.duration, { nativeAudio: await hasAudio(twitch), holds: S.twitch.holds, framed: true })];
    else { console.warn('  video/clips/twitch.mp4 missing: placeholder card used (the real clip is required for submission)'); S.twitch.parts = [imagePart(await card('twitch', 'Add video/clips/twitch.mp4', 'A real stream with the Hivemind overlay in OBS and people chatting'), S.twitch.duration)]; }

    const codexClip = path.join(clipsDir, 'codex.mp4');
    const commits = await commitHistory();
    const repo = repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//, '');
    if (await exists(codexClip)) {
      const split = S.codex.cues[2].start - 0.1;
      S.codex.parts = [clipPart(codexClip, Number(process.env.VIDEO_CODEX_START) || 0, split, { framed: true }), await motionPart(S.codex, 'codex', split, S.codex.duration, { commits, repo })];
    } else {
      console.warn('  video/clips/codex.mp4 missing: showing the commit timeline only');
      S.codex.parts = [await motionPart(S.codex, 'codex', 0, S.codex.duration, { commits, repo })];
    }

    if (rec) {
      const { landing, overlay, dashboard } = rec;
      const tryA = Math.min(landing.length - 0.5, 0.42 * S.try.duration);
      const landingStart = Math.max(0, Math.min((landing.scenario ?? landing.length) + 2.5, landing.length) - tryA);
      // The overlay is designed for a 1920x1080 stream with its UI along the bottom; zoom in a little so it reads well.
      const overlayZoom = { framed: true, crop: '1600:900:0:180' };
      S.try.parts = [clipPart(landing.file, landingStart, tryA, { framed: true }), clipPart(overlay.file, (overlay.firstUpdate ?? 2) - 0.8, S.try.duration - tryA, overlayZoom)];
      const ctlA = Math.min(11, 0.45 * S.controls.duration);
      const ctlB = S.controls.duration - ctlA;
      let dashStart = (dashboard.ask ?? 0) - 0.5;
      if (dashboard.answer && dashboard.answer > dashStart + ctlB - 3) dashStart = dashboard.answer - ctlB + 3;
      S.controls.parts = [clipPart(overlay.file, (overlay.events ?? 0) - 0.3, ctlA, overlayZoom), clipPart(dashboard.file, dashStart, ctlB, { framed: true, crop: '1440:810:240:20' })];
    } else {
      const placeholder = await card('site', 'Live-site recording', 'Skipped in this run (--no-site); run without it to record the real sandbox');
      S.try.parts = [imagePart(placeholder, S.try.duration)];
      S.controls.parts = [imagePart(placeholder, S.controls.duration)];
    }
  } finally { await browser.close(); }

  console.log('4/5 Scenes');
  const files = [];
  for (const [i, scene] of scenes.entries()) { files.push(await buildScene(scene, i)); console.log(`  ${String(i + 1).padStart(2, '0')} ${scene.id.padEnd(9)} ${fmt(scene.start)} – ${fmt(scene.start + scene.duration)}`); }

  console.log(`5/5 Final 4K encode with subtitles (x264 ${preset}; the slow part)`);
  const list = path.join(buildDir, 'scenes.txt');
  await writeFile(list, files.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  // Run from buildDir so the subtitle path needs no Windows drive-letter escaping.
  await run(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'ass=subtitles.ass', '-r', String(FPS), '-c:v', 'libx264', '-preset', preset, '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', finalPath], buildDir);
  const duration = await probe(finalPath);
  console.log(`\nDone in ${((Date.now() - started) / 60000).toFixed(1)} min.`);
  console.log(`Video:     ${path.relative(root, finalPath)}  (${fmt(duration)}, ${W}x${H})`);
  console.log(`Subtitles: ${path.relative(root, srtPath)}`);
  if (DRY) console.log('Dry run: the narration is silent. Run without --dry for the real voiceover.');
  if (duration >= MAX_SECONDS) throw new Error(`Final video is ${fmt(duration)}; it must stay under 2:58.`);
}

export { motion, scenes };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`\nVideo pipeline failed: ${error instanceof Error ? error.message : error}`); process.exitCode = 1; });
