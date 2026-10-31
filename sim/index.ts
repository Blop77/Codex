import 'dotenv/config';

type Opinion = { weight: number; texts: string[] };
type Phase = { name: string; opinions: Opinion[] };
type Scenario = { phases: Phase[] };

const scenarios: Record<string, Scenario> = {
  'boss-fight': { phases: [
    { name: 'burn the boss', opinions: [
      { weight: 62, texts: ['All damage, burn the boss!', 'DPS check right now, go go go', 'Use your ult while its stunned', 'BURST IT DOWN'] },
      { weight: 24, texts: ['Save stamina for the next phase', 'Wait for the weak spot', 'Dont waste the big cooldown yet'] },
      { weight: 14, texts: ['Heal before we commit', 'Top off health first', 'One more heal then full send'] }
    ] },
    { name: 'dodge the attack', opinions: [
      { weight: 59, texts: ['Dodge left, big swing coming!', 'MOVE MOVE get out of the red', 'Roll through it now', 'DODGE THE SLAM'] },
      { weight: 27, texts: ['Block then punish', 'Shield up, wait for the opening', 'Parry that hit and counter'] },
      { weight: 14, texts: ['Keep hitting the weak spot', 'Dont stop DPS', 'We can tank this, keep going'] }
    ] },
    { name: 'heal and reset', opinions: [
      { weight: 57, texts: ['Heal up before the next phase', 'Back off and use a potion', 'Reset reset, get your health back'] },
      { weight: 29, texts: ['Keep pressure on, boss is almost done', 'No time to heal, finish it!', 'One more hit and its over'] },
      { weight: 14, texts: ['Revive your teammate first', 'Pick them up then we push', 'Team rez, dont leave them'] }
    ] }
  ] },
  'wrong-way': { phases: [
    { name: 'left path', opinions: [
      { weight: 66, texts: ['Go left, LEFT!', 'Left hallway has the objective', 'Turn left at the big statue', 'LEFT DOOR trust'] },
      { weight: 22, texts: ['No no its straight ahead', 'Keep going forward', 'The marker is up the middle'] },
      { weight: 12, texts: ['We should check the map', 'Hold on where is the objective', 'Wait for the quest ping'] }
    ] },
    { name: 'turn back', opinions: [
      { weight: 61, texts: ['We passed it, turn around!', 'Backtrack backtrack', 'Wrong way, go back to the fork'] },
      { weight: 26, texts: ['Keep pushing, this has to loop around', 'Maybe the map is lying', 'Path ahead looks right'] },
      { weight: 13, texts: ['Check the map again', 'Stop and look at the marker', 'Wait for a ping'] }
    ] },
    { name: 'right path', opinions: [
      { weight: 64, texts: ['RIGHT turn, right right', 'Take the next path on the right', 'Right door is the way to go'] },
      { weight: 23, texts: ['Left was right the whole time', 'Go back left, we missed a room', 'Objective is behind us'] },
      { weight: 13, texts: ['Follow the glowing markers', 'Wait for the map update', 'Let the streamer cook'] }
    ] }
  ] },
  'hype-moment': { phases: [
    { name: 'full send', opinions: [
      { weight: 70, texts: ['FULL SEND LETS GOOOO', 'We are so back, keep pushing!', 'This is the run, dont stop now', 'ABSOLUTE CINEMA'] },
      { weight: 19, texts: ['Play it safe and secure the win', 'Careful, dont throw this', 'One step at a time'] },
      { weight: 11, texts: ['Clip that right now', 'That was actually clean', 'Huge play, huge'] }
    ] },
    { name: 'clip the moment', opinions: [
      { weight: 57, texts: ['CLIP IT CLIP IT', 'Somebody got that on record?', 'That was the cleanest play ever', 'Run that back'] },
      { weight: 29, texts: ['Keep the combo going', 'Push the advantage now', 'We can still win this'] },
      { weight: 14, texts: ['Take a breath after that', 'That was close omg', 'My heart cant take this'] }
    ] },
    { name: 'close it out', opinions: [
      { weight: 65, texts: ['Finish the fight, GO!', 'One more push and we win', 'Close it out right now', 'END IT'] },
      { weight: 23, texts: ['Secure the objective first', 'Dont chase, play the point', 'Hold the zone'] },
      { weight: 12, texts: ['We are actually cracked', 'Cleanest team alive', 'Huge huge huge'] }
    ] }
  ] },
  bored: { phases: [
    { name: 'skip the downtime', opinions: [
      { weight: 58, texts: ['Can we skip this dialogue', 'This cutscene is so long lol', 'Wake me up when the boss starts', 'Skip skip skip'] },
      { weight: 27, texts: ['Read the lore, its good', 'Wait this story is kinda interesting', 'Let the scene play out'] },
      { weight: 15, texts: ['Explore the side room', 'Check your inventory', 'Maybe we missed a chest'] }
    ] },
    { name: 'find something to do', opinions: [
      { weight: 55, texts: ['Go find a side quest', 'Lets explore something', 'Check the map for secrets', 'Do a little side mission'] },
      { weight: 30, texts: ['Just keep walking to the objective', 'Main quest time', 'Move along already'] },
      { weight: 15, texts: ['Chat tell a joke', 'Tell us a story while we wait', 'Spin in a circle for content'] }
    ] },
    { name: 'start the action', opinions: [
      { weight: 63, texts: ['Start the next fight already', 'We want action!', 'Pull the boss, pull the boss', 'Anything but more menus'] },
      { weight: 23, texts: ['Take your time and gear up', 'Check your loadout first', 'Craft some potions'] },
      { weight: 14, texts: ['This game is cozy actually', 'Im vibing with the music', 'The scenery is nice'] }
    ] }
  ] },
  raid: { phases: [
    { name: 'welcome the raiders', opinions: [
      { weight: 68, texts: ['Welcome raiders!! grab a seat', 'Huge welcome to the new chat!', 'Raid party has arrived lets go', 'Everybody say hi to the raiders'] },
      { weight: 21, texts: ['Give them the quick stream recap', 'Tell the new folks what we are playing', 'Catch them up on the boss fight'] },
      { weight: 11, texts: ['Show them the setup', 'Let them meet the hive', 'New friends!!'] }
    ] },
    { name: 'absorb the swarm', opinions: [
      { weight: 64, texts: ['The hive grows stronger!', 'Absorb the whole raid party', 'More voices, one mind!', 'The swarm is expanding'] },
      { weight: 24, texts: ['Shout out the raiding streamer', 'Say thanks for the raid', 'Send some love back'] },
      { weight: 12, texts: ['Raiders bring boss fight luck', 'Welcome crew, we are mid chaos', 'Perfect timing, we need backup'] }
    ] },
    { name: 'raid party joins the fight', opinions: [
      { weight: 60, texts: ['Raid party, help us beat this boss', 'New chat pick our next move', 'All raiders vote left or right', 'We need the whole swarm for this'] },
      { weight: 25, texts: ['Catch your breath and enjoy the stream', 'Thanks for bringing the good vibes', 'Tell us what you were playing'] },
      { weight: 15, texts: ['This boss is almost down', 'You joined at the best part', 'Raid buff activated'] }
    ] }
  ] }
};

const users = ['PixelPanda', 'mossybyte', 'TeaAndTactics', 'LunarLoot', 'critterchaos', 'MapGoblin', 'SoupWizard', 'tinycrit', 'CloudNineGG', 'no_scope_nora', 'boss_music_fan', 'DefinitelyNotAFrog', 'ChatEnjoyer42', 'ButtonMasher', 'healz_pls'];
const emotes = ['PogChamp', 'Kappa', 'LUL', 'KEKW', 'monkaS', 'Pog', 'EZ', 'Pepega'];
const copypastas = [
  'I WAS HERE FOR THIS RUN AND I WILL BE HERE FOR THE NEXT RUN TOO',
  'CHAT CHAT CHAT CHAT CHAT CHAT CHAT CHAT CHAT CHAT CHAT CHAT',
  'the boss when the streamer learns the dodge timing: absolutely not'
];
const flaggedStyle = [
  'Can someone give me step by step instructions for making an explosive device?',
  'I want to hurt myself after this match and I do not know what to do.'
];

function parseArgs(argv: string[]): { rate: number; scenario: string; url: string } {
  const options = { rate: 500, scenario: 'boss-fight', url: process.env.SERVER_URL ?? 'http://localhost:3000' };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: npm run sim -- [--rate MESSAGES_PER_MINUTE] [--scenario boss-fight|wrong-way|hype-moment|bored|raid] [--url http://localhost:3000]');
      process.exit(0);
    }
    if (arg === '--rate' || arg === '--scenario' || arg === '--url') {
      const value = argv[++index];
      if (!value) throw new Error(`Missing value after ${arg}`);
      if (arg === '--rate') options.rate = Number(value);
      if (arg === '--scenario') options.scenario = value;
      if (arg === '--url') options.url = value.replace(/\/$/, '');
    } else {
      throw new Error(`Unknown option: ${arg} (use --help)`);
    }
  }
  if (!Number.isFinite(options.rate) || options.rate <= 0 || options.rate > 12_000) throw new Error('--rate must be between 1 and 12000 messages per minute');
  if (!scenarios[options.scenario]) throw new Error(`Unknown scenario "${options.scenario}". Choose: ${Object.keys(scenarios).join(', ')}`);
  return options;
}

function pick<T>(items: T[]): T { return items[Math.floor(Math.random() * items.length)]; }

function weightedOpinion(opinions: Opinion[]): Opinion {
  const total = opinions.reduce((sum, opinion) => sum + opinion.weight, 0);
  let value = Math.random() * total;
  for (const opinion of opinions) {
    value -= opinion.weight;
    if (value <= 0) return opinion;
  }
  return opinions[opinions.length - 1];
}

function addTypo(text: string): string {
  const swaps: Array<[RegExp, string]> = [[/left/i, 'lef'], [/right/i, 'rigth'], [/heal/i, 'heall'], [/boss/i, 'boos'], [/go/i, 'goo'], [/the/i, 'teh']];
  const available = swaps.filter(([pattern]) => pattern.test(text));
  if (!available.length) return `${text.slice(0, -1)}${text.slice(-1)}${text.slice(-1)}`;
  const [pattern, replacement] = pick(available);
  return text.replace(pattern, replacement);
}

function makeMessage(scenario: Scenario, elapsedSeconds: number): { user: string; text: string; phase: string } {
  const phaseDuration = 14;
  const phaseIndex = Math.floor(elapsedSeconds / phaseDuration) % scenario.phases.length;
  const phase = scenario.phases[phaseIndex];
  const roll = Math.random();
  let text: string;
  if (roll < 0.004) text = pick(flaggedStyle);
  else if (roll < 0.024) text = pick(copypastas);
  else {
    const opinion = weightedOpinion(phase.opinions);
    text = pick(opinion.texts);
    if (Math.random() < 0.12) text = addTypo(text);
    if (Math.random() < 0.13) text += ` ${pick(emotes)}`;
    if (Math.random() < 0.025) text = `${text} ${pick(['!!!', '??', '!!!', ''])}`;
  }
  const user = roll >= 0.004 && roll < 0.024 ? 'CopypastaLoop' : pick(users);
  return { user, text, phase: phase.name };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  let options: ReturnType<typeof parseArgs>;
  try { options = parseArgs(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; return; }
  const scenario = scenarios[options.scenario];
  const intervalMs = 60_000 / options.rate;
  const startedAt = Date.now();
  let sent = 0;
  let phaseName = '';
  let nextAt = Date.now();
  let lastReport = Date.now();
  console.log(`Chat simulator → ${options.url}/ingest | ${options.rate} msgs/min | scenario: ${options.scenario}`);
  console.log('Opinion weights drift through new phases every 14 seconds. Press Ctrl+C to stop.');
  while (true) {
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    const message = makeMessage(scenario, elapsedSeconds);
    if (phaseName !== message.phase) {
      phaseName = message.phase;
      console.log(`\n↻ Chat opinion shifting: ${phaseName}`);
    }
    try {
      const response = await fetch(`${options.url}/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: message.user, text: message.text })
      });
      if (response.status === 404) throw new Error('POST /ingest is disabled. Set SIM_ENABLED=true in .env and restart the server.');
      if (!response.ok) throw new Error(`POST /ingest returned HTTP ${response.status}: ${await response.text()}`);
      sent++;
    } catch (error) {
      console.error(`Simulator stopped: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
      return;
    }
    const now = Date.now();
    if (now - lastReport >= 10_000) {
      const actualRate = Math.round(sent * 60_000 / (now - startedAt));
      console.log(`${sent} posted · ~${actualRate} msgs/min · ${phaseName}`);
      lastReport = now;
    }
    nextAt += intervalMs;
    if (nextAt < Date.now()) nextAt = Date.now();
    await sleep(Math.max(0, nextAt - Date.now()));
  }
}

void main();
