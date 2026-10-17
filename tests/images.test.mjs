import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageAttachmentSchema, maxImageBytes } from '../src/images.ts';
import { image } from './image-fixture.mjs';

test('saved attachments accept bounded inline images and reject remote, active, or malformed sources', () => {
  assert.deepEqual(imageAttachmentSchema.parse(image), image);
  for (const dataUrl of [
    'https://example.com/a.png',
    'file:///private/a.png',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,',
    'data:image/png;base64,A',
    'data:image/png;base64,AA=A',
  ]) {
    assert.equal(imageAttachmentSchema.safeParse({ ...image, dataUrl }).success, false, dataUrl);
  }
  const dataUrl = 'data:image/png;base64,' + Buffer.alloc(maxImageBytes).toString('base64');
  assert.equal(imageAttachmentSchema.safeParse({ ...image, dataUrl }).success, true);
  assert.equal(
    imageAttachmentSchema.safeParse({ ...image, dataUrl: dataUrl + 'AAAA' }).success,
    false,
  );
});
