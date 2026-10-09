import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeConfig,
  readContact,
  CACHE_DURATION,
  ALERT_CHECK_INTERVAL,
} from '../src/config.js';

test('works with no configuration', () => {
  assert.deepEqual(normalizeConfig(), {
    contact: '',
    cacheDuration: CACHE_DURATION.default,
    alertCheckInterval: ALERT_CHECK_INTERVAL.default,
  });
  assert.deepEqual(normalizeConfig(null), normalizeConfig({}));
});

test('bounds the durations and reads numbers sent as strings', () => {
  const config = normalizeConfig({ cache_duration: '900', alert_check_interval: 5 });
  assert.equal(config.cacheDuration, 900);
  assert.equal(config.alertCheckInterval, ALERT_CHECK_INTERVAL.min);
  assert.equal(normalizeConfig({ cache_duration: 99999 }).cacheDuration, CACHE_DURATION.max);
  assert.equal(normalizeConfig({ cache_duration: '' }).cacheDuration, CACHE_DURATION.default);
  assert.equal(normalizeConfig({ cache_duration: 'abc' }).cacheDuration, CACHE_DURATION.default);
  assert.equal(normalizeConfig({ cache_duration: 0 }).cacheDuration, 0);
});

test('keeps the contact safe for an HTTP header', () => {
  assert.equal(readContact(' me@example.com '), 'me@example.com');
  assert.equal(readContact('me@example.com\r\nX-Evil: 1'), 'me@example.comX-Evil: 1');
  assert.equal(readContact('a (b)'), 'a b');
  assert.equal(readContact(42), '');
  assert.equal(readContact('x'.repeat(300)).length, 100);
});
