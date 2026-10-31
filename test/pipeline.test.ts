import assert from 'node:assert/strict';
import test from 'node:test';
import { clusterByCosine, dedupeMessages, mergeIntentGroups, type ChatMessage } from '../src/pipeline.ts';

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
    { clusterIndexes: [0, 1, 2], label: 'Go left' },
    { clusterIndexes: [3], label: 'Heal first' },
    { clusterIndexes: [4], label: 'Explore the statue' }
  ]);

  assert.deepEqual(merged.map(({ label }) => label), ['Go left', 'Heal first', 'Explore the statue']);
  assert.deepEqual(merged.map(({ share }) => Math.round(share * 100)), [54, 22, 12]);
  assert.deepEqual(merged[0].examples, ['Go left', 'Left door', 'Trust the left path']);
  assert.equal(merged.some((group) => group.examples.includes('Unrelated noise')), false);
});

test('intent merging assigns a raw cluster only once and returns at most three groups', () => {
  const clusters = [0.4, 0.3, 0.2, 0.1].map((share, index) => ({
    share,
    members: [{ ...messages[index % messages.length], text: `example ${index}` }]
  }));
  const merged = mergeIntentGroups(clusters, [
    { clusterIndexes: [0, 0], label: 'First' },
    { clusterIndexes: [0, 1], label: 'Second' },
    { clusterIndexes: [2], label: 'Third' },
    { clusterIndexes: [3], label: 'Fourth' }
  ]);
  assert.deepEqual(merged.map((group) => group.label), ['First', 'Second', 'Third']);
  assert.deepEqual(merged.map((group) => group.share), [0.4, 0.3, 0.2]);
});
