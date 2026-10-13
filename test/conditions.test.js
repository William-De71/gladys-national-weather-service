import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseIcon,
  conditionFromIcon,
  conditionFromText,
  readCondition,
  isDayFromIcon,
  conditionLabel,
  ICON_CONDITIONS,
  CONDITION_LABELS,
} from '../src/conditions.js';

const ICON = 'https://api.weather.gov/icons/land';

test('parses an icon URL', () => {
  assert.deepEqual(parseIcon(`${ICON}/day/tsra_hi,40?size=medium`), {
    isDay: true,
    parts: [{ code: 'tsra_hi', chance: 40 }],
  });
  assert.deepEqual(parseIcon(`${ICON}/night/rain_showers,30/tsra,60`), {
    isDay: false,
    parts: [
      { code: 'rain_showers', chance: 30 },
      { code: 'tsra', chance: 60 },
    ],
  });
  assert.equal(parseIcon(null), null);
  assert.equal(parseIcon('https://example.com/picture.png'), null);
  assert.equal(parseIcon(`${ICON}/dusk/skc`), null);
});

test('maps every NWS icon code to a pivot condition', () => {
  Object.values(ICON_CONDITIONS).forEach((condition) => {
    assert.ok(condition in CONDITION_LABELS, condition);
  });
  assert.equal(conditionFromIcon(`${ICON}/day/skc`), 'clear');
  assert.equal(conditionFromIcon(`${ICON}/day/sct`), 'partly-cloudy');
  assert.equal(conditionFromIcon(`${ICON}/night/ovc`), 'cloud');
  assert.equal(conditionFromIcon(`${ICON}/day/fzra,80`), 'freezing-rain');
  assert.equal(conditionFromIcon(`${ICON}/day/tornado`), 'tornado');
  assert.equal(conditionFromIcon(`${ICON}/day/tropical_storm`), 'hurricane');
});

test('sums up a transition by its most significant phenomenon', () => {
  assert.equal(conditionFromIcon(`${ICON}/night/rain_showers,30/tsra,60`), 'thunderstorm');
  assert.equal(conditionFromIcon(`${ICON}/day/snow,40/few`), 'snow');
});

test('reads the condition of a text when the icon is missing', () => {
  assert.equal(conditionFromText('Chance Showers And Thunderstorms'), 'thunderstorm');
  assert.equal(conditionFromText('Thunder Snow'), 'snow-thunderstorm');
  assert.equal(conditionFromText('Freezing Drizzle'), 'freezing-rain');
  assert.equal(conditionFromText('Partly Cloudy'), 'partly-cloudy');
  assert.equal(conditionFromText('Mostly Sunny'), 'clear');
  assert.equal(conditionFromText('Mostly Cloudy'), 'cloud');
  assert.equal(conditionFromText('Patchy Fog'), 'fog');
  assert.equal(conditionFromText('Heavy Rain'), 'pouring');
  assert.equal(conditionFromText(''), 'unknown');
  assert.equal(conditionFromText('Volcanic eruption'), 'unknown');
  assert.equal(readCondition(null, 'Light Snow'), 'snow');
  assert.equal(readCondition(`${ICON}/day/unknowncode`, 'Sunny'), 'clear');
});

test('reads day and night from the icon', () => {
  assert.equal(isDayFromIcon(`${ICON}/day/skc`), true);
  assert.equal(isDayFromIcon(`${ICON}/night/skc`), false);
  assert.equal(isDayFromIcon(null), undefined);
});

test('labels the conditions in the four languages, English for any other', () => {
  assert.equal(conditionLabel('rain', 'fr'), 'Pluie');
  assert.equal(conditionLabel('rain', 'de'), 'Regen');
  assert.equal(conditionLabel('rain', 'es'), 'Lluvia');
  assert.equal(conditionLabel('rain', 'it'), 'Rain');
  assert.equal(conditionLabel('nonsense', 'en'), 'Unknown');
});
