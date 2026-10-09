import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sunTimes } from '../src/sun.js';

const minutes = (date) => date.getUTCHours() * 60 + date.getUTCMinutes();

test('computes the sun times of a Kansas autumn day', () => {
  // Linn, KS on 2026-10-10: sunrise 7:33 AM, sunset 6:57 PM CDT.
  const { sunrise, sunset } = sunTimes('2026-10-10', 39.7456, -97.0892);
  assert.ok(Math.abs(minutes(sunrise) - (12 * 60 + 33)) <= 3, sunrise.toISOString());
  assert.ok(Math.abs(minutes(sunset) - (23 * 60 + 57)) <= 3, sunset.toISOString());
  assert.ok(sunset > sunrise);
});

test('keeps the evening of a western date on that local date', () => {
  // Honolulu: the sunset falls on the next UTC day.
  const { sunrise, sunset } = sunTimes('2026-06-21', 21.3, -157.86);
  assert.equal(sunrise.toISOString().slice(0, 10), '2026-06-21');
  assert.equal(sunset.toISOString().slice(0, 10), '2026-06-22');
});

test('returns null during the polar day and on bad input', () => {
  assert.equal(sunTimes('2026-06-21', 71.29, -156.79), null);
  assert.equal(sunTimes('21/06/2026', 40, -100), null);
  assert.equal(sunTimes('2026-06-21', Number.NaN, -100), null);
});
