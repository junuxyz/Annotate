import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { same, until } from './assertions.mjs';

test('failed DOM comparisons produce a small boolean diagnostic instead of inspecting the document', () => {
  const window = new Window();
  try {
    const node = window.document.createElement('div');
    window.document.body.append(node);
    same(node, node);
    assert.throws(
      () => same(node, null, 'Popup was not removed'),
      (error) => {
        assert.equal(error.actual, false);
        assert.equal(error.expected, true);
        assert.ok(error.message.length < 300);
        return true;
      },
    );
  } finally {
    window.happyDOM.abort();
  }
});

test('cleanup checks wait for removal and time out with a bounded diagnostic', async () => {
  let removed = false;
  setTimeout(() => {
    removed = true;
  }, 20);
  await until(() => removed, 'Popup was not removed');
  await assert.rejects(
    until(() => false, 'Popup was not removed', 20),
    /Popup was not removed/,
  );
});
