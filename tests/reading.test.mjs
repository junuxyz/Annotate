import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import {
  projectSource,
  sectionBounds,
  sectionMapping,
  markReadingAnchor,
  clearReadingMarks,
  selectedSourceRange,
} from '../src/reading.ts';
import { makeAnchor } from '../src/model.ts';
const win = new Window(),
  doc = win.document;
after(async () => win.happyDOM.close());
const root = (html) => {
  const el = doc.createElement('div');
  el.innerHTML = html;
  doc.body.append(el);
  return el;
};

test('reading projection maps emphasis, links, code, entities and Korean to source offsets', () => {
  const source = '# 제목\n\nA **굵게** and [link](https://example.com) `code` &amp; \\*.';
  assert.equal(projectSource(source, doc).text, '제목 A 굵게 and link code & *.');
  const el = root(
    '<p>A <strong>굵게</strong> and <a href="https://example.com">link</a> <code>code</code> &amp; *.</p>',
  );
  const bounds = sectionBounds(source, 2, 2);
  assert.ok(sectionMapping(el, source, bounds));
  const from = source.indexOf('굵게'),
    to = source.indexOf(' `code`');
  const marks = markReadingAnchor(
    el,
    source,
    bounds,
    makeAnchor(source, from, to),
    'annotate-highlight',
    'thread',
  );
  assert.equal(marks.map((mark) => mark.textContent).join(''), '굵게 and link');
  assert.ok(el.querySelector('strong .annotate-highlight'));
  assert.ok(el.querySelector('a .annotate-highlight'));
  clearReadingMarks(el);
  assert.equal(
    el.innerHTML,
    '<p>A <strong>굵게</strong> and <a href="https://example.com">link</a> <code>code</code> &amp; *.</p>',
  );
});
test('reading selection converts text across inline formatting into the exact Markdown range', () => {
  const source = 'A **bold** and [link](url) end.';
  const el = root('<p>A <strong>bold</strong> and <a>link</a> end.</p>');
  const range = doc.createRange();
  range.setStart(el.querySelector('strong').firstChild, 1);
  range.setEnd(el.querySelector('a').firstChild, 3);
  const selection = selectedSourceRange(el, source, { from: 0, to: source.length }, range);
  assert.equal(source.slice(selection.from, selection.to), 'old** and [lin');
});
test('collapsed whitespace retains the first space source offset and trims both ends', () => {
  const projected = projectSource(' \tA  B\n', doc);
  assert.equal(projected.text, 'A B');
  assert.deepEqual(projected.points, [
    { from: 2, to: 3 },
    { from: 3, to: 4 },
    { from: 5, to: 6 },
  ]);
});
test('identical rendered passages in separate blocks retain their own positions', () => {
  const source = 'same text\n\nsame text';
  const first = root('<p>same text</p>'),
    second = root('<p>same text</p>');
  const anchor = makeAnchor(source, 11, source.length);
  assert.equal(
    markReadingAnchor(first, source, sectionBounds(source, 0, 0), anchor, 'annotate-highlight')
      .length,
    0,
  );
  assert.equal(
    markReadingAnchor(second, source, sectionBounds(source, 2, 2), anchor, 'annotate-highlight')
      .length,
    1,
  );
});
test('overlapping reading highlights keep formatting and remove cleanly', () => {
  const source = 'one two three';
  const el = root('<p>one two three</p>'),
    bounds = { from: 0, to: source.length };
  markReadingAnchor(el, source, bounds, makeAnchor(source, 0, 7), 'annotate-highlight', 'a');
  markReadingAnchor(el, source, bounds, makeAnchor(source, 4, 13), 'annotate-highlight', 'b');
  assert.equal(el.textContent, source);
  assert.ok(el.querySelector('[data-annotate-thread="a"] [data-annotate-thread="b"]'));
  clearReadingMarks(el);
  assert.equal(el.innerHTML, '<p>one two three</p>');
});
test('unmappable rendered content is left intact rather than highlighted at a wrong position', () => {
  const el = root('<p>custom rendered output</p>'),
    source = 'different source';
  assert.equal(
    markReadingAnchor(
      el,
      source,
      { from: 0, to: source.length },
      makeAnchor(source, 0, 5),
      'annotate-highlight',
    ).length,
    0,
  );
  assert.equal(el.innerHTML, '<p>custom rendered output</p>');
});
