import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Text } from '@codemirror/state';
import {
  defaultHighlights,
  highlightEdit,
  highlightStyle,
  highlightChanges,
  highlightSettingsSchema,
  noteHighlights,
  outsideInlineTags,
  textColorEdit,
  textColors,
  type TextColor,
} from '../src/highlight';
import { emptyData, dataSchema, makeAnchor, mapAnchor } from '../src/model';
const yellow = { id: 'yellow', name: 'Yellow', value: '#ffe06680' };
const pink = { id: 'pink', name: 'Pink', value: '#ff8fc780' };
function apply(source: string, from: number, to: number, color: typeof yellow | null = yellow) {
  const edit = highlightEdit(source, from, to, color, 'rounded');
  assert.ok(edit);
  const changes = highlightChanges(source, edit);
  const result = changes.apply(Text.of(source.split('\n'))).toString();
  assert.equal(result, source.slice(0, edit.from) + edit.insert + source.slice(edit.to));
  return { result, changes };
}
void test('highlight, recolor and remove preserve Korean text without nesting marks', () => {
  let { result } = apply('앞 한글 passage 뒤', 2, 12);
  assert.match(result, /data-annotate-highlight="yellow"/);
  let from = result.indexOf('한글'),
    to = from + '한글 passage'.length;
  result = apply(result, from, to, pink).result;
  assert.equal((result.match(/<mark /g) ?? []).length, 1);
  assert.match(result, /data-annotate-highlight="pink"/);
  from = result.indexOf('한글');
  to = from + '한글 passage'.length;
  assert.equal(apply(result, from, to, null).result, '앞 한글 passage 뒤');
});
void test('partial recolor splits the old highlight and preserves its remaining color', () => {
  const { result } = apply('abcdef', 0, 6);
  const recolored = apply(
    result,
    result.indexOf('abcdef') + 2,
    result.indexOf('abcdef') + 4,
    pink,
  ).result;
  assert.equal((recolored.match(/<mark /g) ?? []).length, 3);
  assert.match(
    recolored,
    />ab<\/mark><mark[^>]*pink[^>]*>cd<\/mark><mark[^>]*yellow[^>]*>ef<\/mark>/,
  );
});
void test('highlighting across existing marks keeps all characters and flattens the selection', () => {
  const first = apply('one two three', 4, 7).result;
  const next = apply(first, 0, first.length, pink).result;
  assert.equal((next.match(/<mark /g) ?? []).length, 1);
  assert.match(next, />one two three<\/mark>$/);
});
void test('multiline highlights preserve block syntax and comment anchors', () => {
  const source = '# 제목\n\n- first\n- second';
  const anchor = makeAnchor(source, source.indexOf('first'), source.length);
  const { result, changes } = apply(source, 0, source.length);
  assert.match(result, /^# <mark/);
  assert.match(result, /\n- <mark/);
  const mapped = mapAnchor(anchor, changes, result);
  assert.equal(mapped.orphaned, false);
  assert.ok(mapped.quote.startsWith('first'));
  assert.ok(mapped.quote.endsWith('second'));
  assert.equal(result.slice(mapped.from, mapped.to), mapped.quote);
});
void test('existing comments survive wrapper insertions and recoloring', () => {
  const source = 'prefix text suffix',
    anchor = makeAnchor(source, 7, 11);
  const { result, changes } = apply(source, 7, 11);
  const mapped = mapAnchor(anchor, changes, result);
  assert.equal(mapped.quote, 'text');
  assert.equal(mapped.orphaned, false);
  const next = apply(result, mapped.from, mapped.to, pink);
  assert.equal(mapAnchor(mapped, next.changes, next.result).quote, 'text');
});
void test('code, tag fragments and invalid selections do not alter note syntax', () => {
  for (const source of ['`<mark>code</mark>`', '```js\nhello\n```'])
    assert.equal(highlightEdit(source, 0, source.length, yellow, 'rounded'), null);
  assert.equal(highlightEdit('<mark>text</mark>', 2, 9, yellow, 'rounded'), null);
});
const [, red, , , , blue] = textColors;
function color(source: string, from: number, to: number, value: TextColor | null = red) {
  const edit = textColorEdit(source, from, to, value);
  assert.ok(edit);
  const changes = highlightChanges(source, edit, 'span');
  const result = changes.apply(Text.of(source.split('\n'))).toString();
  assert.equal(result, source.slice(0, edit.from) + edit.insert + source.slice(edit.to));
  return { result, changes, edit };
}
void test('text color wraps, recolors, partially splits and removes without nesting spans', () => {
  const first = color('앞 한글 passage 뒤', 2, 12);
  let result = first.result;
  const edit = first.edit;
  assert.equal(
    result,
    '앞 <span data-annotate-color="red" style="color: var(--color-red, #e03e3e);">한글 passage</span> 뒤',
  );
  assert.equal(result.slice(edit.selectionFrom, edit.selectionTo), '한글 passage');
  const from = result.indexOf('passage');
  result = color(result, from, from + 'passage'.length, blue).result;
  assert.match(result, /red[^>]*>한글<\/span> <span[^>]*blue[^>]*>passage<\/span> 뒤$/);
  const start = result.indexOf('한글'),
    end = result.indexOf('passage') + 'passage'.length;
  assert.equal(color(result, start, end, null).result, '앞 한글 passage 뒤');
  assert.deepEqual(
    noteHighlights(color('a b c', 2, 3).result, 'span').map((span) => span.id),
    ['red'],
  );
});
void test('text color and highlights nest cleanly when ranges cross', () => {
  const highlighted = apply('one two three', 0, 7).result;
  const from = highlighted.indexOf('two'),
    to = highlighted.indexOf('three') + 'three'.length;
  const { result, edit } = color(highlighted, from, to);
  assert.match(result, /<mark[^>]*>one <span[^>]*>two<\/span><\/mark><span[^>]*> three<\/span>$/);
  assert.equal(
    result.slice(edit.selectionFrom, edit.selectionTo).replace(/<[^>]+>/g, ''),
    'two three',
  );
  const spans = noteHighlights(result, 'span');
  assert.equal(spans.length, 2);
  assert.equal(noteHighlights(result).length, 1);
  // Highlighting over colored text keeps the color spans intact.
  const next = apply(result, result.indexOf('>one') + 1, result.length).result;
  assert.equal(noteHighlights(next, 'span').length, 2);
  assert.equal(next.replace(/<[^>]+>/g, ''), 'one two three');
});
void test('text color keeps comment anchors and refuses foreign or broken spans', () => {
  const source = 'prefix text suffix',
    anchor = makeAnchor(source, 7, 11);
  const { result, changes } = color(source, 7, 11);
  assert.equal(mapAnchor(anchor, changes, result).quote, 'text');
  const foreign = '<span class="x">keep me</span>';
  assert.equal(textColorEdit(foreign, 16, 20, red), null);
  assert.equal(textColorEdit('`code`', 0, 6, red), null);
  assert.ok(textColorEdit(foreign + ' other', foreign.length + 1, foreign.length + 6, red));
});
void test('older saved data gets the default palette and settings reject CSS injection', () => {
  const data = emptyData();
  const { highlights, ...old } = data;
  assert.deepEqual(dataSchema.parse(old).highlights, defaultHighlights());
  assert.equal(
    highlightSettingsSchema.parse({ ...highlights, textRecent: undefined }).textRecent,
    'red',
  );
  assert.ok(highlightSettingsSchema.safeParse(highlights).success);
  assert.equal(
    highlightSettingsSchema.safeParse({
      ...highlights,
      colors: [{ ...yellow, value: 'red;display:none' }],
    }).success,
    false,
  );
});

void test('highlighting keeps emphasis delimiters outside HTML for Live Preview', () => {
  const source = '**제목** : 가운데만 보이는 **터널 시각**이 나타남. *기울임*과 ~~취소선~~';
  const { result } = apply(source, 0, source.length);
  assert.match(result, /\*\*<mark[^>]*>터널 시각<\/mark>\*\*<mark[^>]*>이/);
  assert.match(result, /\*<mark[^>]*>기울임<\/mark>\*/);
  assert.match(result, /~~<mark[^>]*>취소선<\/mark>~~/);
  assert.equal(result.replace(/<[^>]+>/g, ''), source);
  const partial = apply(source, source.indexOf('시각'), source.indexOf('나타남') + 3).result;
  assert.match(partial, /터널 <mark[^>]*>시각<\/mark>\*\*<mark[^>]*>이 나타남<\/mark>/);
});

void test('formatting survives color, highlight, recolor and removal with existing HTML', () => {
  const source = '**제목** : **터널 시각**이 나타남.';
  const colored = color(source, 0, source.length).result;
  assert.match(colored, /\*\*<span[^>]*>터널 시각<\/span>\*\*/);
  let result = apply(colored, 0, colored.length).result;
  assert.match(result, /\*\*<span[^>]*><mark[^>]*>터널 시각<\/mark><\/span>\*\*/);
  result = apply(result, 0, result.length, pink).result;
  result = apply(result, 0, result.length, null).result;
  assert.equal(result, colored);
  assert.equal(color(result, 0, result.length, null).result, source);
  const legacy = `<mark data-annotate-highlight="yellow">${source}</mark>`;
  const repaired = apply(legacy, 0, legacy.length, pink).result;
  assert.match(repaired, /\*\*<mark[^>]*>터널 시각<\/mark>\*\*/);
});

void test('partial recoloring preserves bold styling and comment anchors without accumulating styles', () => {
  const source = '**터널 시각**이 나타남.';
  const first = apply(source, 0, source.length);
  let result = first.result;
  let anchor = mapAnchor(makeAnchor(source, 2, 7), first.changes, result);
  for (let i = 0; i < 3; i++) {
    const from = result.indexOf('시각');
    const next = apply(result, from, from + 2, pink);
    anchor = mapAnchor(anchor, next.changes, next.result);
    result = next.result;
  }
  assert.equal(anchor.orphaned, false);
  assert.equal(anchor.quote.replace(/<[^>]+>/g, ''), '터널 시각');
  for (const mark of result.matchAll(/<mark\b[^>]*>([^<]*)/g))
    assert.equal(
      (mark[0].match(/font-weight:/g) ?? []).length,
      /터널|시각/.test(mark[1] ?? '') ? 1 : 0,
    );
});

void test('saved highlights inherit text color and retain their light-mode palette', () => {
  const { result } = apply('흰 글자와 기존 글자색 유지', 0, 15);
  assert.match(result, /style="color: inherit; background: #ffe06680;/);
  assert.equal(result.replace(/<[^>]+>/g, ''), '흰 글자와 기존 글자색 유지');
  for (const shape of ['rounded', 'flat', 'underline'] as const) {
    const light = highlightStyle(yellow.value, shape);
    const dark = highlightStyle(yellow.value, shape, 'dark');
    assert.match(light, /color: inherit;/);
    assert.match(dark, /color: inherit;/);
    assert.ok(!light.includes('color-mix'));
    assert.ok(dark.includes('color-mix'), `${shape} uses a dimmer dark highlight`);
    if (shape === 'underline') assert.match(dark, /background: transparent;/);
  }
});

void test('comment badges escape enclosing highlight and color widgets without crossing adjacent text', () => {
  for (const first of ['mark', 'span'] as const) {
    const plain = '앞 한글 passage 뒤';
    const styled = first === 'mark' ? apply(plain, 2, 12).result : color(plain, 2, 12).result;
    for (const source of [
      styled,
      first === 'mark'
        ? color(styled, styled.indexOf('한글'), styled.indexOf('passage') + 7).result
        : apply(styled, styled.indexOf('한글'), styled.indexOf('passage') + 7).result,
    ]) {
      const ranges = [...noteHighlights(source), ...noteHighlights(source, 'span')];
      const end = source.indexOf(' 뒤');
      assert.equal(outsideInlineTags(source.indexOf('한글') + 2, ranges), end);
      assert.equal(outsideInlineTags(source.indexOf('passage') + 7, ranges), end);
      assert.equal(outsideInlineTags(1, ranges), 1);
      assert.equal(outsideInlineTags(end, ranges), end);
    }
  }
});
