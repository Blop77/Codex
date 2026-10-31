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

export type IntentGroup = { clusterIndexes: number[]; label: string };
export type ConsensusCluster = { label: string; share: number; examples: string[] };

export function mergeIntentGroups(
  clusters: readonly Pick<MessageCluster, 'members' | 'share'>[],
  intentGroups: readonly IntentGroup[],
  maxGroups = 3,
  maxExamples = 4
): ConsensusCluster[] {
  const assigned = new Set<number>();
  return intentGroups.slice(0, maxGroups).map((group) => {
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

    return {
      label: group.label.trim(),
      share: merged.reduce((sum, cluster) => sum + cluster.share, 0),
      examples
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
