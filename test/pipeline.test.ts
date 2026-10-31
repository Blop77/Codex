import assert from 'node:assert/strict';
import test from 'node:test';
import { clusterByCosine, dedupeMessages, type ChatMessage } from '../src/pipeline.ts';

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
