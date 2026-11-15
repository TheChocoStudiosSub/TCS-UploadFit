import test from 'node:test';
import assert from 'node:assert/strict';
import { filterValidPresets } from '../src/presets.js';

test('validates local preset objects before allowing them to be applied', () => {
  const raw = [
    { id: 'recipe-good', name: ' Valid ', settings: { width: '1200' } },
    { id: 'recipe-bad', name: 'Invalid', settings: { width: '0x10' } },
    { id: 'recipe-empty', name: ' ', settings: { width: '' } },
    { id: 'recipe-no-settings', name: 'Missing' },
    { id: 'recipe-good', name: 'Duplicate ID', settings: { width: '' } }
  ];
  const filtered = filterValidPresets(raw, settings => {
    if (settings.width === '0x10') throw new Error('invalid width');
  });
  assert.deepEqual(filtered.map(item => [item.id, item.name]), [['recipe-good', 'Valid']]);
});

test('caps stored presets and rejects malformed names and identifiers', () => {
  const records = Array.from({ length: 35 }, (_, index) => ({
    id: `recipe-${index}`, name: `Preset ${index}`, settings: {}
  }));
  records.push({ id: 'bad-id', name: 'Bad ID', settings: {} });
  records.push({ id: 'recipe-too-long', name: 'x'.repeat(41), settings: {} });
  assert.equal(filterValidPresets(records, () => {}, 30).length, 30);
});

test('returns an empty list for malformed storage values', () => {
  assert.deepEqual(filterValidPresets(null, () => {}), []);
  assert.deepEqual(filterValidPresets({}, () => {}), []);
});

test('does not trust a stored internal normalized marker', () => {
  const filtered = filterValidPresets([
    { id: 'recipe-forged', name: 'Forged', settings: { _normalized: true, width: '0x10' } }
  ], settings => {
    assert.equal(Object.hasOwn(settings, '_normalized'), false);
    if (settings.width === '0x10') throw new Error('invalid width');
  });
  assert.deepEqual(filtered, []);
});
