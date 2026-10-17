import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from './dom.mjs';
import {
  fillModelOptions,
  featuredModelLabels,
  createOtherModelPicker,
} from '../src/model-picker.ts';

test('model picker separates free, paid and unknown prices while preserving selectable model IDs', async () => {
  const window = new Window();
  try {
    const select = window.document.createElement('select');
    fillModelOptions({
      select,
      labels: {
        '': 'Automatic',
        'provider/paid': 'Paid model',
        'provider/free': 'Free model',
        'provider/unknown': 'Unknown model',
        'provider/saved': 'Saved model',
      },
      pricing: { 'provider/paid': 'paid', 'provider/free': 'free', 'provider/unknown': 'unknown' },
    });
    assert.equal(select.firstElementChild.value, '');
    assert.deepEqual(
      [...select.querySelectorAll('optgroup')].map((group) => [
        group.label,
        [...group.children].map((item) => item.value),
      ]),
      [
        ['Free', ['provider/free']],
        ['Paid', ['provider/paid']],
        ['Price unavailable', ['provider/unknown', 'provider/saved']],
      ],
    );
    select.value = 'provider/paid';
    assert.equal(select.value, 'provider/paid');
    fillModelOptions({
      select,
      labels: { '': 'Automatic', 'provider/free': 'Free model' },
      pricing: { 'provider/free': 'free' },
    });
    assert.deepEqual(
      [...select.querySelectorAll('optgroup')].map((group) => group.label),
      ['Free'],
    );
    assert.equal(select.options.length, 2);
    fillModelOptions({ select, labels: { '': 'Check to load models' }, pricing: {} });
    assert.equal(select.options.length, 1);
    assert.equal(select.querySelector('optgroup'), null);
  } finally {
    await window.happyDOM.close();
  }
});

test('featured picker shows only the two requested models and preserves a saved other choice', () => {
  const labels = {
    'opencode/deepseek-v4.1-flash-free': 'DeepSeek',
    'opencode/glm-5.3-flash-free': 'GLM',
    'provider/other': 'Other model',
  };
  assert.deepEqual(Object.keys(featuredModelLabels(labels, '')), [
    'opencode/deepseek-v4.1-flash-free',
    'opencode/glm-5.3-flash-free',
  ]);
  assert.deepEqual(Object.keys(featuredModelLabels(labels, 'provider/other')), [
    'opencode/deepseek-v4.1-flash-free',
    'opencode/glm-5.3-flash-free',
    'provider/other',
  ]);
  assert.deepEqual(featuredModelLabels({}, ''), { '': 'Check to load models' });
  assert.deepEqual(featuredModelLabels({ 'provider/other': 'Other' }, ''), {
    '': 'Choose a model in Others',
  });
});

test('Others searches all models by name or ID and selects an explicit model without changing on search', async () => {
  const window = new Window();
  try {
    const container = window.document.createElement('div');
    const chosen = [];
    let labels = { 'provider/model-a': 'Alpha', 'provider/model-b': 'Beta' };
    const picker = createOtherModelPicker({
      container,
      labels: () => labels,
      pricing: () => ({ 'provider/model-a': 'free', 'provider/model-b': 'paid' }),
      onChoose: (id) => chosen.push(id),
    });
    const search = container.querySelector('input');
    const select = container.querySelector('select');
    assert.equal(select.options.length, 3);
    search.value = 'provider BETA';
    search.dispatchEvent(new window.Event('input'));
    assert.deepEqual(
      [...select.options].map((option) => option.value),
      ['', 'provider/model-b'],
    );
    assert.deepEqual(chosen, []);
    select.value = 'provider/model-b';
    select.dispatchEvent(new window.Event('change'));
    assert.deepEqual(chosen, ['provider/model-b']);
    search.value = 'provider/model-a';
    search.dispatchEvent(new window.Event('input'));
    assert.equal(select.options[1].value, 'provider/model-a');
    search.value = 'missing';
    search.dispatchEvent(new window.Event('input'));
    assert.equal(select.options.length, 1);
    assert.equal(select.options[0].textContent, 'No matching models');
    labels = { ...labels, 'provider/missing': 'New model' };
    picker.refresh();
    assert.equal(select.options[1].value, 'provider/missing');
  } finally {
    await window.happyDOM.close();
  }
});
