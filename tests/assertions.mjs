import assert from 'node:assert/strict';

// Compare references before asserting so a failure never inspects a browser's object graph.
export function same(actual, expected, message = 'Expected the same object reference') {
  assert.equal(actual === expected, true, message);
}

export async function until(condition, message, timeout = 1000) {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    assert.ok(Date.now() < deadline, message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
