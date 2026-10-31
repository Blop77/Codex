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

export function cleanIntentLabel(label: string): string {
  const words = label.trim().split(/\s+/).filter((word) => {
    const token = word.toLocaleLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    return token && !bannedLabelWords.has(token);
  }).slice(0, 3);
  return words.join(' ').toLocaleUpperCase();
}

let fallbackLineCursor = 0;
const fallbackLineTemplates = [
  (label: string, percent: number) => `We say ${label}: ${percent}% of us.`,
  (label: string, percent: number) => `${percent}% of us are calling for ${label}.`,
  (label: string, percent: number) => `We’re leaning ${label}; that’s ${percent}% of our vote.`,
  (label: string, percent: number) => `${label} has the floor with ${percent}% of us behind it.`
];

export function formatCrowdLine(line: string, topOpinion?: Pick<ConsensusCluster, 'label' | 'share'>): string {
  const candidate = line.trim();
  if (candidate && candidate.split(/\s+/).length <= 25) return candidate;
  const label = topOpinion?.label || 'the strongest signal';
  const percent = topOpinion ? Math.round(topOpinion.share * 100) : 0;
  return fallbackLineTemplates[fallbackLineCursor++ % fallbackLineTemplates.length](label, percent);
}

export function mergeIntentGroups(
  clusters: readonly Pick<MessageCluster, 'members' | 'share'>[],
  intentGroups: readonly IntentGroup[],
  maxGroups = 3,
  maxExamples = 4
): MergedIntentGroup[] {
  const assigned = new Set<number>();
  const mergedByLabel = new Map<string, MergedIntentGroup>();
  for (const group of intentGroups.filter((candidate) => candidate.isOpinion).slice(0, maxGroups)) {
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

    const label = cleanIntentLabel(group.label);
    if (!label) continue;
    const evidence = examples.find((example) => normalizeMessage(example) === normalizeMessage(group.evidence)) ?? examples[0] ?? '';
    const share = merged.reduce((sum, cluster) => sum + cluster.share, 0);
    const previous = mergedByLabel.get(label);
    if (previous) {
      previous.share += share;
      for (const example of examples) {
        if (!previous.examples.some((seen) => normalizeMessage(seen) === normalizeMessage(example)) && previous.examples.length < maxExamples) previous.examples.push(example);
      }
      if (!previous.evidence && evidence) previous.evidence = evidence;
    } else {
      mergedByLabel.set(label, { label, share, examples, evidence });
    }
  }
  return [...mergedByLabel.values()].filter((group) => group.examples.length > 0)
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
