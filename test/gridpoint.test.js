import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseDuration, readLayer, valueAt, maxOver, sumOver, readGrid } from '../src/gridpoint.js';
import { fixtures } from './helpers/fixtures.js';

const H = 60 * 60 * 1000;

test('parses the durations of the grid', () => {
  assert.equal(parseDuration('PT1H'), H);
  assert.equal(parseDuration('P4DT2H'), 98 * H);
  assert.equal(parseDuration('PT30M'), H / 2);
  assert.equal(parseDuration('P1D'), 24 * H);
  assert.equal(parseDuration('P'), null);
  assert.equal(parseDuration('garbage'), null);
});

test('reads a layer and its value at an instant', () => {
  const layer = readLayer({
    values: [
      { validTime: '2026-10-09T16:00:00+00:00/PT2H', value: 10 },
      { validTime: '2026-10-09T18:00:00+00:00/PT1H', value: null },
      { validTime: 'broken', value: 3 },
    ],
  });
  assert.equal(layer.length, 1);
  assert.equal(valueAt(layer, Date.parse('2026-10-09T17:30:00Z')), 10);
  assert.equal(valueAt(layer, Date.parse('2026-10-09T18:00:00Z')), undefined);
  assert.deepEqual(readLayer(undefined), []);
});

test('prorates an amount over a window and finds a maximum', () => {
  const layer = readLayer({
    values: [
      { validTime: '2026-10-09T00:00:00+00:00/PT6H', value: 6 },
      { validTime: '2026-10-09T06:00:00+00:00/PT6H', value: 12 },
    ],
  });
  const from = Date.parse('2026-10-09T03:00:00Z');
  assert.equal(sumOver(layer, from, from + H), 1);
  assert.equal(sumOver(layer, from, from + 6 * H), 3 + 6);
  assert.equal(maxOver(layer, from, from + H), 6);
  assert.equal(maxOver(layer, from, from + 6 * H), 12);
  assert.equal(sumOver(layer, 0, 1), undefined);
  assert.equal(maxOver(layer, 0, 1), undefined);
});

test('reads the layers of a real grid', () => {
  const layers = readGrid(fixtures().grid);
  assert.ok(layers.windGust.length > 0);
  assert.ok(layers.quantitativePrecipitation.length > 0);
  assert.deepEqual(readGrid(null).windGust, []);
});
