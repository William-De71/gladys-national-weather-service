// -----------------------------------------------------------------------------
// Non-regression of everything users store: every key of the manifest a
// dashboard, a scene or a saved configuration refers to, the keys of the
// scene event data and action outputs the scenes read, and the image keys the
// core caches.
//
// test/fixtures/discovery.baseline.json was generated from version 1.0.0,
// before any change. A failure here means existing users would lose a widget
// setting, a scene filter or a scene variable: never update the baseline
// without a documented migration. (A weather integration has no devices: no
// external ids.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { iconKey, iconPathFromKey } from '../src/widgets.js';
import { readAlerts } from '../src/alerts.js';
import { buildIssuedData, buildEndedData } from '../src/alert-watcher.js';
import {
  buildAlertsOutputs,
  buildForecastOutputs,
  buildCurrentOutputs,
} from '../src/scene-actions.js';
import { buildWeather } from '../src/weather.js';
import { feature } from './helpers/alert-feature.js';
import { fixtures, NOW, LATITUDE, LONGITUDE, TIME_ZONE } from './helpers/fixtures.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const baseline = read('./fixtures/discovery.baseline.json');
const manifest = read('../gladys-assistant-integration.json');

const byKey = (list) => new Map((list ?? []).map((entry) => [entry.key, entry]));
const optionValues = (field) => (field?.options ?? []).map((option) => option.value);

/**
 * @description Check that every stored key keeps its type.
 * @param {object[]} current - The current fields.
 * @param {object[]} stored - The baseline `[{ key, type }]`.
 * @param {string} where - The entry, for the messages.
 */
function assertFieldsKept(current, stored, where) {
  const now = byKey(current);
  for (const { key, type } of stored) {
    assert.equal(now.get(key)?.type, type, `${where}.${key}`);
  }
}

/**
 * @description Check that every stored option value is still offered.
 * @param {object[]} fields - The current fields of a manifest entry.
 * @param {object} options - The baseline `{ fieldKey: [values] }`.
 * @param {string} where - The entry, for the messages.
 */
function assertOptionsKept(fields, options, where) {
  const current = byKey(fields);
  for (const [key, stored] of Object.entries(options ?? {})) {
    const offered = optionValues(current.get(key));
    for (const value of stored) {
      assert.ok(offered.includes(value), `${where}.${key}: ${value}`);
    }
  }
}

test('stays a cloud weather integration', () => {
  assert.equal(manifest.type, baseline.manifest.type);
  assert.deepEqual(manifest.transports, baseline.manifest.transports);
});

test('no configuration key disappears or changes type', () => {
  assertFieldsKept(manifest.config_schema, baseline.manifest.config_schema, 'config_schema');
});

test('scene triggers keep their keys, filters, filter values and variables', () => {
  const current = byKey(manifest.scene_triggers);
  for (const trigger of baseline.manifest.scene_triggers) {
    const now = current.get(trigger.key);
    assert.ok(now, `scene_triggers.${trigger.key}`);
    assertFieldsKept(now.fields, trigger.fields, `${trigger.key}.fields`);
    assertOptionsKept(now.fields, trigger.options, trigger.key);
    assertFieldsKept(now.variables, trigger.variables, `${trigger.key}.variables`);
  }
});

test('scene actions keep their keys, fields, field values and outputs', () => {
  const current = byKey(manifest.scene_actions);
  for (const action of baseline.manifest.scene_actions) {
    const now = current.get(action.key);
    assert.ok(now, `scene_actions.${action.key}`);
    assertFieldsKept(now.fields, action.fields, `${action.key}.fields`);
    assertOptionsKept(now.fields, action.options, action.key);
    assertFieldsKept(now.outputs, action.outputs, `${action.key}.outputs`);
  }
});

test('widgets keep their keys, settings, setting types and option values', () => {
  const current = byKey(manifest.widgets);
  for (const widget of baseline.manifest.widgets) {
    const now = current.get(widget.key);
    assert.ok(now, `widgets.${widget.key}`);
    assertFieldsKept(now.settings, widget.settings, `${widget.key}.settings`);
    assertOptionsKept(now.settings, widget.options, widget.key);
  }
});

test('the code still fills every scene variable and action output of 1.0.0', () => {
  const [alert] = readAlerts([feature({})], NOW);
  const context = { house: 'Home', language: 'en', timeZone: TIME_ZONE };
  const f = fixtures();
  const weather = buildWeather(
    {
      point: f.point,
      observation: f.observation.properties,
      hourly: f.hourly,
      forecast: f.forecast,
      grid: f.grid,
      alerts: [],
    },
    { units: 'us', latitude: LATITUDE, longitude: LONGITUDE },
  );
  const produced = {
    alert_issued_data: buildIssuedData(alert, context),
    alert_ended_data: buildEndedData(alert, context),
    get_alerts_outputs: buildAlertsOutputs({ alerts: [alert], ...context }),
    get_forecast_outputs: buildForecastOutputs({
      forecast: f.forecast,
      timeZone: TIME_ZONE,
      house: 'Home',
      language: 'en',
      units: 'us',
      day: '1',
      now: NOW,
    }),
    get_current_outputs: buildCurrentOutputs({
      weather,
      observation: null,
      house: 'Home',
      timeZone: TIME_ZONE,
      language: 'en',
      units: 'us',
    }),
  };
  for (const [name, keys] of Object.entries(baseline.code)) {
    for (const key of keys) {
      assert.ok(key in produced[name], `${name}.${key}`);
    }
  }
});

test('the icon image keys cached by the core are still produced and understood', () => {
  for (const [key, { url, path }] of Object.entries(baseline.image_keys.examples)) {
    assert.equal(iconKey(url), key);
    assert.equal(iconPathFromKey(key), path);
  }
});
