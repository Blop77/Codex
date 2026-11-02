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

test('intent merging combines shares, carries evidence, filters noise, sorts and omits leftovers', () => {
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

test('paraphrases for the left route merge into one intent instead of three bars', () => {
  const paraphrases = ['go left', 'take the left door', 'left at the statue'];
  const clusters = paraphrases.map((example, index) => ({
    share: [0.4, 0.35, 0.25][index],
    members: [{ ...messages[index % messages.length], text: example }]
  }));

  const merged = mergeIntentGroups(clusters, [{
    clusterIndexes: [0, 1, 2],
    label: 'Go left',
    evidence: paraphrases[0],
    isOpinion: true
  }]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].label, 'GO LEFT');
  assert.equal(merged[0].share, 1);
  assert.deepEqual(merged[0].examples, paraphrases);
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

test('intent merging trusts the model label after light cleanup', () => {
  const cluster = {
    share: 0.62,
    members: [{ ...messages[0], text: 'All damage, burn the boss!' }]
  };
  const [merged] = mergeIntentGroups([cluster], [{
    clusterIndexes: [0], label: 'Cautious Play', evidence: 'All damage, burn the boss!', isOpinion: true
  }]);
  assert.equal(merged.label, 'CAUTIOUS PLAY');
});

test('duplicate cleaned labels combine their shares and examples', () => {
  const clusters = [0.4, 0.3, 0.2].map((share, index) => ({
    share,
    members: [{ ...messages[index], text: `example ${index}` }]
  }));
  const [merged] = mergeIntentGroups(clusters, [
    { clusterIndexes: [0], label: 'Go left', evidence: 'example 0', isOpinion: true },
    { clusterIndexes: [1], label: 'go left', evidence: 'example 1', isOpinion: true },
    { clusterIndexes: [2], label: 'Right', evidence: 'example 2', isOpinion: true }
  ]);
  assert.equal(merged.label, 'GO LEFT');
  assert.equal(merged.share, 0.7);
  assert.deepEqual(merged.examples, ['example 0', 'example 1']);
});

test('model crowd line is trusted and only empty or overlong lines use varying fallbacks', () => {
  assert.equal(formatCrowdLine('We are split, but most of us want the left path. 62% is convincing.', { label: 'GO LEFT', share: 0.62 }), 'We are split, but most of us want the left path. 62% is convincing.');
  const longLine = Array(26).fill('word').join(' ');
  const first = formatCrowdLine(longLine, { label: 'GO LEFT', share: 0.6 });
  const second = formatCrowdLine('', { label: 'GO LEFT', share: 0.6 });
  assert.notEqual(first, second);
  assert.match(first, /GO LEFT/);
  assert.match(second, /GO LEFT/);
  assert.equal(formatCrowdLine('Short model line'), 'Short model line');
});
