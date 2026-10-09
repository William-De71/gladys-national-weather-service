import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { SCENE_ACTIONS, MAX_DAY_OFFSET } from '../src/scene-actions.js';
import { SCENE_TRIGGERS } from '../src/alert-watcher.js';
import { CATEGORIES, LEVELS, SEVERITIES } from '../src/alerts.js';
import { WIDGETS, HOURLY_METRICS, HOURLY_SPANS } from '../src/widgets.js';
import { CACHE_DURATION, ALERT_CHECK_INTERVAL } from '../src/config.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const manifest = read('../gladys-assistant-integration.json');
const pkg = read('../package.json');

const byKey = (list) => new Map(list.map((entry) => [entry.key, entry]));
const values = (field) => field.options.map((option) => option.value);

test('is a weather provider, in lockstep with package.json', () => {
  assert.equal(manifest.type, 'weather');
  assert.equal(manifest.location, true);
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${pkg.version}`));
});

test('declares exactly the scene triggers, actions and widgets the code handles', () => {
  assert.deepEqual(
    manifest.scene_triggers.map((trigger) => trigger.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
  assert.deepEqual(
    manifest.scene_actions.map((action) => action.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key).sort(),
    Object.values(WIDGETS).sort(),
  );
});

test('filters the alerts on the values the code produces', () => {
  const issued = byKey(manifest.scene_triggers).get(SCENE_TRIGGERS.ALERT_ISSUED);
  const fields = byKey(issued.fields);
  assert.deepEqual(values(fields.get('category')), CATEGORIES);
  assert.deepEqual(values(fields.get('level')), LEVELS);
  assert.deepEqual(values(fields.get('severity')), [...SEVERITIES, 'unknown']);
});

test('makes every filter readable by the actions too', () => {
  manifest.scene_triggers.forEach((trigger) => {
    const variables = new Set(trigger.variables.map((variable) => variable.key));
    trigger.fields.forEach((field) =>
      assert.ok(variables.has(field.key), `${trigger.key}.${field.key}`),
    );
  });
});

test('mirrors the bounds of the code', () => {
  const config = byKey(manifest.config_schema);
  ['min', 'max', 'default'].forEach((bound) => {
    assert.equal(config.get('cache_duration')[bound], CACHE_DURATION[bound]);
    assert.equal(config.get('alert_check_interval')[bound], ALERT_CHECK_INTERVAL[bound]);
  });
  const day = byKey(byKey(manifest.scene_actions).get(SCENE_ACTIONS.GET_FORECAST).fields).get(
    'day',
  );
  assert.equal(day.options.length, MAX_DAY_OFFSET + 1);
  const hourly = byKey(byKey(manifest.widgets).get(WIDGETS.HOURLY).settings);
  assert.deepEqual(values(hourly.get('metric')), HOURLY_METRICS);
  assert.deepEqual(values(hourly.get('hours')), HOURLY_SPANS);
});
