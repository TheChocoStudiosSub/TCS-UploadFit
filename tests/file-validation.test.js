import test from 'node:test';
import assert from 'node:assert/strict';
import { fileDedupKey, validateIncomingFiles } from '../src/file-validation.js';

const file = (name, size, lastModified = 100, type = 'image/jpeg') => ({
  name, size, lastModified, type
});

test('deduplicates by case-insensitive name, size and modification time', () => {
  const original = file('Photo.jpg', 1024, 200);
  const duplicate = file('photo.jpg', 1024, 200);
  const differentTime = file('photo.jpg', 1024, 201);
  assert.equal(fileDedupKey(original), fileDedupKey(duplicate));
  assert.notEqual(fileDedupKey(original), fileDedupKey(differentTime));
  const result = validateIncomingFiles([duplicate, differentTime], [original], 5, 10_000);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0], differentTime);
  assert.equal(result.skipped.duplicate, 1);
});

test('classifies size, empty, format, duplicate and queue rejection independently', () => {
  const result = validateIncomingFiles([
    file('large.jpg', 20_000),
    file('empty.jpg', 0),
    file('vector.svg', 400, 1, 'image/svg+xml'),
    file('already.jpg', 100, 3),
    file('extra.jpg', 100, 4)
  ], [file('already.jpg', 100, 3), file('used.jpg', 100, 2)], 3, 10_000);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.skipped.tooLarge, 1);
  assert.equal(result.skipped.empty, 1);
  assert.equal(result.skipped.unsupported, 1);
  assert.equal(result.skipped.duplicate, 1);
  assert.equal(result.skipped.overCount, 0);
});

test('rejects new files after the configured queue limit', () => {
  const result = validateIncomingFiles([
    file('third.jpg', 100, 3),
    file('fourth.jpg', 100, 4)
  ], [file('first.jpg', 100, 1), file('second.jpg', 100, 2)], 3, 10_000);
  assert.deepEqual(result.accepted.map(item => item.name), ['third.jpg']);
  assert.equal(result.skipped.overCount, 1);
});
