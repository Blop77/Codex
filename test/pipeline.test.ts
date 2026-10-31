import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanIntentLabel, clusterByCosine, dedupeMessages, formatCrowdLine, mergeIntentGroups, type ChatMessage } from '../src/pipeline.ts';

const messages: ChatMessage[] = [
  { userId: '1', username: 'one', text: 'go left', timestamp: 0 },
  { userId: '2', username: 'two', text: 'LEFT!!', timestamp: 1 },
  { userId: '3', username: 'three', text: 'heal first', timestamp: 2 }
];

test('dedupe removes repeated messages from the same chatter but keeps other chatters voting alike', () => {
  const result = dedupeMessages([
    ...messages,
    { userId: '1', username: 'one', text: '  GO   LEFT ', timestamp: 3 },
    { userId: '4', username: 'four', text: 'go left', timestamp: 4 },
    { userId: '5', username: 'five', text: 'aaaaaaaa', timestamp: 5 }
  ]);
  assert.deepEqual(result.map((message) => message.userId), ['1', '2', '3', '4']);
});

test('greedy cosine clustering assigns nearest matching messages and computes shares', () => {
  const clusters = clusterByCosine(messages, [[1, 0], [0.99, 0.01], [0, 1]], 0.9);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].members.length, 2);
  assert.equal(clusters[0].share, 2 / 3);
  assert.equal(clusters[1].share, 1 / 3);
});

test('clustering rejects mismatched message and embedding counts', () => {
  assert.throws(() => clusterByCosine(messages, [[1, 0]], 0.7), /counts must match/);
});

test('intent merging combines shares, carries merged examples, sorts by share, and omits leftovers', () => {
  const clusterShares = [0.2, 0.18, 0.16, 0.22, 0.12, 0.1];
  const examples = ['Go left', 'Left door', 'Trust the left path', 'Heal first', 'Explore the statue', 'Unrelated noise'];
  const clusters = clusterShares.map((share, index) => ({
    share,
    members: [{ ...messages[index % messages.length], text: examples[index] }]
  }));

  const merged = mergeIntentGroups(clusters, [
    { clusterIndexes: [0, 1, 2], label: 'Go left', evidence: 'Left door', isOpinion: true },
    { clusterIndexes: [3], label: 'Heal first', evidence: 'Heal first', isOpinion: true },
    { clusterIndexes: [4], label: 'Explore the statue', evidence: 'Explore the statue', isOpinion: true },
    { clusterIndexes: [5], label: 'random emotes', evidence: 'Unrelated noise', isOpinion: false }
  ]);

  assert.deepEqual(merged.map(({ label }) => label), ['GO LEFT', 'HEAL FIRST', 'EXPLORE THE STATUE']);
  assert.deepEqual(merged.map(({ share }) => Math.round(share * 100)), [54, 22, 12]);
  assert.deepEqual(merged[0].examples, ['Go left', 'Left door', 'Trust the left path']);
  assert.equal(merged[0].evidence, 'Left door');
  assert.equal(merged.some((group) => group.examples.includes('Unrelated noise')), false);
});

test('intent merging assigns a raw cluster only once and returns at most three groups', () => {
  const evidence = ['Burn first', 'Heal second', 'Dodge third', 'Block fourth'];
  const clusters = [0.4, 0.3, 0.2, 0.1].map((share, index) => ({
    share,
    members: [{ ...messages[index % messages.length], text: evidence[index] }]
  }));
  const merged = mergeIntentGroups(clusters, [
    { clusterIndexes: [0, 0], label: 'Burn first', evidence: evidence[0], isOpinion: true },
    { clusterIndexes: [0, 1], label: 'Heal second', evidence: evidence[1], isOpinion: true },
    { clusterIndexes: [2], label: 'Dodge third', evidence: evidence[2], isOpinion: true },
    { clusterIndexes: [3], label: 'Block fourth', evidence: evidence[3], isOpinion: true }
  ]);
  assert.deepEqual(merged.map((group) => group.label), ['BURN FIRST', 'HEAL SECOND', 'DODGE THIRD']);
  assert.deepEqual(merged.map((group) => group.share), [0.4, 0.3, 0.2]);
});

test('intent labels stay within three words and remove generic banned terms', () => {
  assert.equal(cleanIntentLabel('GO LEFT RIGHT NOW'), 'GO LEFT RIGHT');
  assert.equal(cleanIntentLabel('Cautious recommendations, advice'), 'CAUTIOUS');
});

test('intent labels unsupported by their exact examples fall back to the example action', () => {
  const cluster = {
    share: 0.62,
    members: [{ ...messages[0], text: 'All damage, burn the boss!' }]
  };
  const [merged] = mergeIntentGroups([cluster], [{
    clusterIndexes: [0], label: 'Cautious Play', evidence: 'All damage, burn the boss!', isOpinion: true
  }]);
  assert.equal(merged.label, 'BURN BOSS');
});

test('crowd line names the top opinion and exact share in first-person plural under 18 words', () => {
  const line = formatCrowdLine('We say left. Sixty percent of us. Keep moving!', { label: 'GO LEFT', share: 0.6 });
  assert.equal(line, 'We say left. Sixty percent of us.');
  assert.ok(line.split(/\s+/).length < 18);
  assert.equal(formatCrowdLine('Pick fast.' , { label: 'HEAL FIRST', share: 0.42 }), 'We say HEAL FIRST. 42% of us.');
  assert.equal(formatCrowdLine('WE SAY GO LEFT. Twenty-one percent of us. Don\'t make us repeat it.', { label: 'GO LEFT', share: 0.6 }), 'We say GO LEFT. 60% of us.');
  assert.equal(formatCrowdLine('Any line'), 'We are still finding the signal. Give us a moment.');
});
