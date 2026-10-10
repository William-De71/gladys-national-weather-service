import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createAlertWatcher,
  buildIssuedData,
  buildEndedData,
  SCENE_TRIGGERS,
} from '../src/alert-watcher.js';
import { readAlerts } from '../src/alerts.js';
import { feature } from './helpers/alert-feature.js';
import { NOW, TIME_ZONE } from './helpers/fixtures.js';

const silent = { debug() {}, info() {}, warn() {} };
const HOUSE = { id: 'h1', name: 'Home', selector: 'home', latitude: 39.7456, longitude: -97.0892 };

/**
 * @description Create a watcher whose alerts are set by the test.
 * @param {object} [options] - Overrides.
 * @returns {object} The watcher and its recorders.
 * @example
 * const { watcher, setAlerts, events } = setup();
 */
function setup(options = {}) {
  let features = [];
  let clock = NOW;
  const events = [];
  const changes = [];
  const houseList = [HOUSE];
  const watcher = createAlertWatcher({
    houses: { refresh: async () => houseList },
    loadAlerts: async () => ({ alerts: readAlerts(features, clock), timeZone: TIME_ZONE }),
    publish: async (key, data) => {
      events.push({ key, data });
    },
    onChange: (house) => changes.push(house.id),
    getLanguage: () => 'en',
    getIntervalMs: () => 60000,
    logger: silent,
    now: () => clock,
    ...options,
  });
  return {
    watcher,
    events,
    changes,
    houseList,
    setAlerts: (list) => {
      features = list;
    },
    advance: (ms) => {
      clock += ms;
    },
  };
}

test('takes a baseline first, then fires a new alert once', async () => {
  const { watcher, setAlerts, events, changes } = setup();
  setAlerts([feature({ id: 'heat', event: 'Heat Advisory', severity: 'Moderate' })]);
  await watcher.check();
  assert.equal(events.length, 0, 'the alerts in force at start are the baseline');
  assert.deepEqual(changes, []);

  setAlerts([
    feature({ id: 'heat', event: 'Heat Advisory', severity: 'Moderate' }),
    feature({ id: 'tor' }),
  ]);
  await watcher.check();
  assert.equal(events.length, 1);
  assert.equal(events[0].key, SCENE_TRIGGERS.ALERT_ISSUED);
  assert.equal(events[0].data.event, 'Tornado Warning');
  assert.equal(events[0].data.category, 'tornado');
  assert.equal(events[0].data.level, 'warning');
  assert.equal(events[0].data.severity, 'extreme');
  assert.equal(events[0].data.house, 'Home');
  assert.deepEqual(changes, ['h1']);

  await watcher.check();
  assert.equal(events.length, 1, 'nothing changed, nothing fires');
  assert.deepEqual(changes, ['h1']);
});

test('follows an update through its references without firing again', async () => {
  const { watcher, setAlerts, events, changes } = setup();
  await watcher.check();
  setAlerts([feature({ id: 'v1' })]);
  await watcher.check();
  setAlerts([
    feature({
      id: 'v2',
      messageType: 'Update',
      references: [{ identifier: 'v1' }],
      expires: '2026-10-09T19:15:00-05:00',
    }),
  ]);
  await watcher.check();
  assert.deepEqual(
    events.map((event) => event.key),
    [SCENE_TRIGGERS.ALERT_ISSUED],
  );
  assert.equal(changes.length, 2, 'the update still refreshes the weather payload');
});

test('ends an alert missing twice, or at once when it expired', async () => {
  const { watcher, setAlerts, events, advance } = setup();
  await watcher.check();
  setAlerts([
    feature({ id: 'tor' }),
    feature({ id: 'heat', event: 'Heat Advisory', ends: '2026-10-09T18:20:00-05:00' }),
  ]);
  await watcher.check();
  assert.equal(events.length, 2);

  setAlerts([]);
  await watcher.check();
  assert.deepEqual(
    events.slice(2).map((event) => event.data.event),
    [],
    'one empty answer ends nothing still running',
  );
  advance(10 * 60 * 1000);
  await watcher.check();
  const ended = events.slice(2);
  assert.deepEqual(ended.map((event) => [event.key, event.data.event]).sort(), [
    [SCENE_TRIGGERS.ALERT_ENDED, 'Heat Advisory'],
    [SCENE_TRIGGERS.ALERT_ENDED, 'Tornado Warning'],
  ]);
});

test('does not end an alert on a short outage of the API', async () => {
  const { watcher, setAlerts, events, advance } = setup();
  await watcher.check();
  setAlerts([feature({ id: 'tor', expires: '2026-10-09T19:45:00-05:00' })]);
  await watcher.check();
  setAlerts([]);
  await watcher.check();
  advance(60 * 1000);
  await watcher.check();
  setAlerts([feature({ id: 'tor', expires: '2026-10-09T19:45:00-05:00' })]);
  advance(60 * 1000);
  await watcher.check();
  assert.deepEqual(
    events.map((event) => event.key),
    [SCENE_TRIGGERS.ALERT_ISSUED],
    'two empty answers within five minutes end nothing',
  );
});

test('pairs issued and ended when an ended alert comes back', async () => {
  const { watcher, setAlerts, events, advance } = setup();
  const tornado = () => feature({ id: 'tor', expires: '2026-10-09T20:45:00-05:00' });
  await watcher.check();
  setAlerts([tornado()]);
  await watcher.check();
  setAlerts([]);
  await watcher.check();
  advance(6 * 60 * 1000);
  await watcher.check();
  setAlerts([tornado()]);
  await watcher.check();
  setAlerts([]);
  await watcher.check();
  advance(6 * 60 * 1000);
  await watcher.check();
  assert.deepEqual(
    events.map((event) => event.key),
    [
      SCENE_TRIGGERS.ALERT_ISSUED,
      SCENE_TRIGGERS.ALERT_ENDED,
      SCENE_TRIGGERS.ALERT_ISSUED,
      SCENE_TRIGGERS.ALERT_ENDED,
    ],
  );
});

test('fires an upgrade from a watch to a warning', async () => {
  const { watcher, setAlerts, events } = setup();
  await watcher.check();
  setAlerts([feature({ id: 'watch', event: 'Hurricane Watch', severity: 'Severe' })]);
  await watcher.check();
  setAlerts([
    feature({
      id: 'warning',
      event: 'Hurricane Warning',
      messageType: 'Update',
      references: [{ identifier: 'watch' }],
    }),
  ]);
  await watcher.check();
  assert.deepEqual(
    events.map((event) => [event.key, event.data.event, event.data.level]),
    [
      [SCENE_TRIGGERS.ALERT_ISSUED, 'Hurricane Watch', 'watch'],
      [SCENE_TRIGGERS.ALERT_ENDED, 'Hurricane Watch', 'watch'],
      [SCENE_TRIGGERS.ALERT_ISSUED, 'Hurricane Warning', 'warning'],
    ],
  );
});

test('ends an alert cancelled by the NWS', async () => {
  const { watcher, setAlerts, events, advance } = setup();
  await watcher.check();
  setAlerts([feature({ id: 'tor' })]);
  await watcher.check();
  setAlerts([feature({ id: 'can', messageType: 'Cancel', references: [{ identifier: 'tor' }] })]);
  await watcher.check();
  advance(5 * 60 * 1000);
  await watcher.check();
  assert.deepEqual(
    events.map((event) => event.key),
    [SCENE_TRIGGERS.ALERT_ISSUED, SCENE_TRIGGERS.ALERT_ENDED],
  );
});

test('keeps an alert until further notice past the expiry of its message', async () => {
  const { watcher, setAlerts, events, advance } = setup();
  const flood = (id, references = []) =>
    feature({
      id,
      event: 'Flood Warning',
      severity: 'Severe',
      references,
      expires: '2026-10-09T18:30:00-05:00',
      ends: null,
      parameters: { VTEC: ['/O.NEW.KTOP.FL.W.0001.000000T0000Z-000000T0000Z/'] },
    });
  await watcher.check();
  setAlerts([flood('f1')]);
  await watcher.check();
  advance(60 * 60 * 1000);
  await watcher.check();
  setAlerts([flood('f2', [{ identifier: 'f1' }])]);
  await watcher.check();
  assert.deepEqual(
    events.map((event) => event.key),
    [SCENE_TRIGGERS.ALERT_ISSUED],
    'the late follow-up continues the alert',
  );
  assert.equal(events[0].data.ends, null);
});

test('skips a house outside the NWS coverage for a day', async () => {
  let calls = 0;
  const { watcher, events, advance } = setup({
    loadAlerts: async () => {
      calls += 1;
      const err = new Error('outside');
      err.name = 'OutOfCoverageError';
      throw err;
    },
  });
  await watcher.check();
  await watcher.check();
  assert.equal(calls, 1);
  advance(25 * 60 * 60 * 1000);
  await watcher.check();
  assert.equal(calls, 2);
  assert.equal(events.length, 0);
});

test('survives an API failure and a refused event', async () => {
  let fail = false;
  const { watcher, setAlerts, events } = setup({
    publish: async () => {
      events.push('tried');
      throw new Error('core too old');
    },
  });
  await watcher.check();
  setAlerts([feature({ id: 'tor' })]);
  await watcher.check();
  assert.deepEqual(events, ['tried']);

  const failing = setup({
    loadAlerts: async () => {
      if (fail) throw new Error('503');
      return { alerts: readAlerts([feature({ id: 'tor' })], NOW), timeZone: null };
    },
  });
  await failing.watcher.check();
  fail = true;
  failing.advance(10 * 60 * 1000);
  await failing.watcher.check();
  await failing.watcher.check();
  assert.deepEqual(failing.events, [], 'a failed check is no empty answer');
});

test('forgets a removed house', async () => {
  const { watcher, houseList, setAlerts, events } = setup();
  await watcher.check();
  houseList.length = 0;
  await watcher.check();
  setAlerts([feature({ id: 'tor' })]);
  houseList.push(HOUSE);
  await watcher.check();
  assert.deepEqual(events, [], 'back, the house takes a new baseline');
});

test('builds the event data with local times and a summary', () => {
  const [alert] = readAlerts([feature({ id: 'tor' })], NOW);
  const issued = buildIssuedData(alert, { house: 'Home', language: 'en', timeZone: TIME_ZONE });
  assert.equal(issued.ends, 'Fri 6:45 PM');
  assert.equal(issued.onset, 'Fri 6:00 PM');
  assert.equal(issued.category_label, 'Tornado');
  assert.equal(
    issued.summary,
    'NWS Tornado Warning for Home until Fri 6:45 PM: Tornado Warning issued October 9',
  );
  Object.values(issued).forEach((value) => assert.ok(value === null || typeof value === 'string'));

  const french = buildIssuedData(alert, { house: 'Maison', language: 'fr', timeZone: TIME_ZONE });
  assert.equal(french.level_label, 'Alerte');
  assert.equal(
    french.summary,
    "NWS « Tornado Warning » (tornade, niveau alerte) pour Maison jusqu'à ven. 18:45.",
  );

  const long = readAlerts([feature({ id: 'x', description: 'a'.repeat(3000) })], NOW)[0];
  assert.equal(
    buildIssuedData(long, { house: 'Home', language: 'en', timeZone: null }).description.length,
    1000,
  );

  const ended = buildEndedData(alert, { house: 'Home', language: 'fr', timeZone: TIME_ZONE });
  assert.equal(
    ended.summary,
    "Fin de l'alerte NWS « Tornado Warning » pour Maison.".replace('Maison', 'Home'),
  );
});

test('runs on a timer until stopped', async () => {
  let rounds = 0;
  const { watcher } = setup({
    houses: {
      refresh: async () => {
        rounds += 1;
        return [];
      },
    },
    getIntervalMs: () => 5,
  });
  watcher.start();
  await new Promise((resolve) => setTimeout(resolve, 40));
  watcher.stop();
  const after = rounds;
  assert.ok(after >= 2, `${after} rounds`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(rounds, after);
});
