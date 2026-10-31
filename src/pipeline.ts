export type ChatMessage = {
  userId: string;
  username: string;
  text: string;
  timestamp: number;
};

export type MessageCluster = {
  members: ChatMessage[];
  centroid: number[];
  label: string;
  share: number;
};

export type IntentGroup = { clusterIndexes: number[]; label: string; evidence: string; isOpinion: boolean };
export type ConsensusCluster = { label: string; share: number; examples: string[] };
export type MergedIntentGroup = ConsensusCluster & { evidence: string };

const bannedLabelWords = new Set(['suggestion', 'suggestions', 'recommendation', 'recommendations', 'strategy', 'strategies', 'advice']);
const labelStopWords = new Set(['a', 'an', 'the', 'go', 'take', 'with', 'chat', 'and', 'or', 'of', 'to']);
const evidenceStopWords = new Set(['a', 'an', 'the', 'it', 'is', 'are', 'was', 'were', 'to', 'for', 'and', 'or', 'but', 'we', 'they', 'us', 'our', 'your', 'you', 'me', 'i', 'my', 'while', 'when', 'before', 'after', 'through', 'this', 'that', 'now']);
const imperativeWords = new Set(['burn', 'burst', 'heal', 'dodge', 'roll', 'block', 'parry', 'go', 'turn', 'backtrack', 'check', 'open', 'stop', 'push', 'save', 'wait', 'move', 'revive', 'finish', 'use', 'take', 'follow', 'hold', 'pick', 'attack', 'retreat', 'explore', 'keep']);
const imperativeLabelStarts = new Set(['burn', 'burst', 'heal', 'dodge', 'roll', 'block', 'parry', 'go', 'turn', 'backtrack', 'check', 'open', 'stop', 'push', 'save', 'wait', 'move', 'revive', 'finish', 'use', 'take', 'follow', 'hold', 'pick', 'attack', 'retreat', 'explore', 'keep', 'dps']);
const smallNumbers = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const tensNumbers = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function percentInWords(percent: number): string {
  if (percent < 20) return smallNumbers[percent];
  const tens = Math.floor(percent / 10);
  const remainder = percent % 10;
  return remainder ? `${tensNumbers[tens]} ${smallNumbers[remainder]}` : tensNumbers[tens];
}

export function cleanIntentLabel(label: string): string {
  const words = label.trim().split(/\s+/).filter((word) => {
    const token = word.toLocaleLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    return token && !bannedLabelWords.has(token);
  }).slice(0, 3);
  return (words.join(' ') || 'GO WITH CHAT').toLocaleUpperCase();
}

function labelFromEvidence(examples: string[]): string {
  for (const example of examples) {
    const words: string[] = normalizeMessage(example).match(/[\p{L}\p{N}]+/gu) ?? [];
    if (words.includes('backtrack') || (words.includes('turn') && words.includes('around'))) return 'TURN BACK';
    if (words.includes('straight') || words.includes('middle') || words.includes('forward')) return 'GO STRAIGHT';
    const actionIndex = words.findIndex((word) => imperativeWords.has(word));
    if (actionIndex < 0) continue;
    const phrase = words.slice(actionIndex).filter((word) => !evidenceStopWords.has(word)).slice(0, 3);
    if (phrase.length) return cleanIntentLabel(phrase.join(' '));
  }
  return 'GO WITH CHAT';
}

function isImperativeLabel(label: string): boolean {
  const firstWord = normalizeMessage(label).split(' ')[0];
  return imperativeLabelStarts.has(firstWord);
}

export function formatCrowdLine(line: string, topOpinion?: Pick<ConsensusCluster, 'label' | 'share'>): string {
  if (!topOpinion) return 'We are still finding the signal. Give us a moment.';
  const label = cleanIntentLabel(topOpinion.label);
  const percent = Math.round(topOpinion.share * 100);
  const candidate = line.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
  const hasPluralVoice = /\b(?:we|us|our|we're|we've|we'll|we'd)\b/i.test(candidate);
  const labelWords = normalizeMessage(label).split(' ').filter((word) => !labelStopWords.has(word));
  const normalizedCandidate = normalizeMessage(candidate);
  const hasLabel = labelWords.some((word) => normalizedCandidate.includes(word));
  const hasStrength = new RegExp(`(?:^|\\D)${percent}%(?:$|\\D)`).test(candidate)
    || new RegExp(`\\b${percentInWords(percent)}\\s+percent\\b`, 'i').test(candidate);
  if (hasPluralVoice && hasLabel && hasStrength && candidate.split(/\s+/).length < 18) return candidate;

  const lead = `We say ${label}. ${percent}% of us.`;
  return lead;
}

export function mergeIntentGroups(
  clusters: readonly Pick<MessageCluster, 'members' | 'share'>[],
  intentGroups: readonly IntentGroup[],
  maxGroups = 3,
  maxExamples = 4
): MergedIntentGroup[] {
  const assigned = new Set<number>();
  return intentGroups.filter((group) => group.isOpinion).slice(0, maxGroups).map((group) => {
    const indexes = [...new Set(group.clusterIndexes)].filter((index) =>
      Number.isInteger(index) && index >= 0 && index < clusters.length && !assigned.has(index)
    );
    indexes.forEach((index) => assigned.add(index));

    const merged = indexes.map((index) => clusters[index]);
    const seenExamples = new Set<string>();
    const examples: string[] = [];
    for (const cluster of merged) {
      for (const message of cluster.members) {
        const example = message.text.trim();
        const key = normalizeMessage(example);
        if (!key || seenExamples.has(key)) continue;
        seenExamples.add(key);
        examples.push(example);
        if (examples.length >= maxExamples) break;
      }
      if (examples.length >= maxExamples) break;
    }

    const evidence = examples.find((example) => normalizeMessage(example) === normalizeMessage(group.evidence)) ?? examples[0] ?? '';
    const suppliedLabel = cleanIntentLabel(group.label);
    const labelWords = normalizeMessage(suppliedLabel).split(' ').filter((word) => !labelStopWords.has(word));
    const evidenceWords = new Set(normalizeMessage(evidence).split(/[^\p{L}\p{N}]+/u));
    const hasEvidenceSupport = labelWords.some((word) => evidenceWords.has(word));

    return {
      label: hasEvidenceSupport && isImperativeLabel(suppliedLabel) ? suppliedLabel : labelFromEvidence([evidence, ...examples]),
      share: merged.reduce((sum, cluster) => sum + cluster.share, 0),
      examples,
      evidence
    };
  }).filter((group) => group.examples.length > 0 && group.label.length > 0)
    .sort((left, right) => right.share - left.share);
}

export function normalizeMessage(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

export function dedupeMessages(messages: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  return messages.filter((message) => {
    const normalized = normalizeMessage(message.text);
    if (!normalized || normalized.length > 500 || /^(.)\1{7,}$/u.test(normalized)) return false;
    const key = `${message.userId}:${normalized}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index++) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return leftNorm === 0 || rightNorm === 0 ? 0 : dot / Math.sqrt(leftNorm * rightNorm);
}

export function clusterByCosine(messages: ChatMessage[], vectors: number[][], threshold: number): MessageCluster[] {
  if (messages.length !== vectors.length) throw new Error('Message and embedding counts must match.');
  const clusters: MessageCluster[] = [];
  for (let index = 0; index < messages.length; index++) {
    const vector = vectors[index];
    let bestCluster: MessageCluster | undefined;
    let bestSimilarity = threshold;
    for (const cluster of clusters) {
      const similarity = cosineSimilarity(vector, cluster.centroid);
      if (similarity >= bestSimilarity) {
        bestSimilarity = similarity;
        bestCluster = cluster;
      }
    }
    if (bestCluster) {
      bestCluster.members.push(messages[index]);
      bestCluster.centroid = bestCluster.centroid.map((value, dimension) => value + vector[dimension]);
    } else {
      clusters.push({ members: [messages[index]], centroid: [...vector], label: '', share: 0 });
    }
  }
  for (const cluster of clusters) {
    const magnitude = Math.sqrt(cluster.centroid.reduce((sum, value) => sum + value * value, 0));
    if (magnitude) cluster.centroid = cluster.centroid.map((value) => value / magnitude);
    cluster.share = messages.length ? cluster.members.length / messages.length : 0;
  }
  return clusters.sort((left, right) => right.members.length - left.members.length);
}
