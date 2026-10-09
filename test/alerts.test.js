import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyEvent,
  readLevel,
  readSeverity,
  readAlerts,
  toPivotAlerts,
  countByLevel,
  CATEGORIES,
  CATEGORY_LABELS,
} from '../src/alerts.js';
import { fixtures, NOW } from './helpers/fixtures.js';
import { feature } from './helpers/alert-feature.js';

test('classifies the NWS events', () => {
  const cases = {
    'Tornado Warning': ['tornado', 'thunderstorm'],
    'Tornado Watch': ['tornado', 'thunderstorm'],
    'Hurricane Warning': ['hurricane', 'wind'],
    'Tropical Storm Watch': ['hurricane', 'wind'],
    'Storm Surge Warning': ['hurricane', 'coastal'],
    'Severe Thunderstorm Warning': ['thunderstorm', 'thunderstorm'],
    'Flash Flood Warning': ['flood', 'flood'],
    'Coastal Flood Advisory': ['flood', 'coastal'],
    'Winter Storm Warning': ['winter', 'snow'],
    'Blizzard Warning': ['winter', 'snow'],
    'Ice Storm Warning': ['winter', 'snow'],
    'Avalanche Warning': ['winter', 'avalanche'],
    'Extreme Cold Warning': ['cold', 'cold'],
    'Wind Chill Advisory': ['cold', 'cold'],
    'Freeze Warning': ['cold', 'cold'],
    'Excessive Heat Warning': ['heat', 'heat'],
    'Heat Advisory': ['heat', 'heat'],
    'Red Flag Warning': ['fire', undefined],
    'Dense Fog Advisory': ['fog', 'fog'],
    'Freezing Fog Advisory': ['fog', 'fog'],
    'Air Quality Alert': ['air', undefined],
    'Rip Current Statement': ['marine', 'coastal'],
    'High Wind Warning': ['wind', 'wind'],
    'Special Weather Statement': ['other', undefined],
  };
  Object.entries(cases).forEach(([event, [category, pivot]]) => {
    assert.deepEqual(classifyEvent(event), { category, pivot }, event);
  });
  CATEGORIES.forEach((category) => assert.ok(category in CATEGORY_LABELS, category));
});

test('reads the level and the severity', () => {
  assert.equal(readLevel('Tornado Warning'), 'warning');
  assert.equal(readLevel('Tornado Watch '), 'watch');
  assert.equal(readLevel('Heat Advisory'), 'advisory');
  assert.equal(readLevel('Special Weather Statement'), 'statement');
  assert.equal(readLevel('Air Quality Alert'), 'other');
  assert.equal(readSeverity('Extreme'), 'extreme');
  assert.equal(readSeverity('Unknown'), 'unknown');
  assert.equal(readSeverity(undefined), 'unknown');
});

test('reads real alerts, the most serious first', () => {
  const alerts = readAlerts(fixtures().alerts.features, NOW - 2 * 60 * 60 * 1000);
  assert.deepEqual(
    alerts.map((alert) => alert.event),
    [
      'Red Flag Warning',
      'Special Weather Statement',
      'Coastal Flood Advisory',
      'Air Quality Alert',
    ],
  );
  const [redFlag] = alerts;
  assert.equal(redFlag.level, 'warning');
  assert.equal(redFlag.severity, 'severe');
  assert.ok(redFlag.references.length > 0);
  assert.match(redFlag.headline, /RED FLAG WARNING/);
});

test('drops tests, cancellations, malformed and expired alerts', () => {
  const alerts = readAlerts(
    [
      feature({ id: 'a' }),
      feature({ id: 'b', status: 'Test' }),
      feature({ id: 'c', messageType: 'Cancel' }),
      feature({ id: 'd', expires: '2026-10-09T17:00:00-05:00' }),
      { properties: { id: 'e' } },
      null,
    ],
    NOW,
  );
  assert.deepEqual(
    alerts.map((alert) => alert.id),
    ['a'],
  );
  assert.deepEqual(readAlerts(undefined), []);
});

test('maps the alerts to the pivot format', () => {
  const alerts = readAlerts(
    [feature({ id: 'a' }), feature({ id: 'b', event: 'Air Quality Alert', severity: 'Unknown' })],
    NOW,
  );
  const [tornado, air] = toPivotAlerts(alerts);
  assert.deepEqual(tornado, {
    severity: 'extreme',
    event: 'Tornado Warning',
    description: 'Tornado Warning issued October 9\n\nA tornado was observed.\n\nTAKE COVER NOW!',
    type: 'thunderstorm',
    start: '2026-10-09T18:00:00-05:00',
    end: '2026-10-09T18:45:00-05:00',
  });
  assert.equal(air.severity, 'minor');
  assert.equal(air.type, undefined);
  const many = readAlerts(
    Array.from({ length: 12 }, (_, index) => feature({ id: `x${index}` })),
    NOW,
  );
  assert.equal(toPivotAlerts(many).length, 10);
});

test('counts the alerts by level', () => {
  const alerts = readAlerts(
    [
      feature({ id: 'a' }),
      feature({ id: 'b', event: 'Tornado Watch' }),
      feature({ id: 'c', event: 'Heat Advisory' }),
    ],
    NOW,
  );
  assert.deepEqual(countByLevel(alerts), {
    warning: 1,
    watch: 1,
    advisory: 1,
    statement: 0,
    other: 0,
  });
});
