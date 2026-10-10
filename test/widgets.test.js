import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import {
  buildAlertsWidget,
  buildForecastWidget,
  buildHourlyWidget,
  iconKey,
  iconPathFromKey,
  periodTitle,
  readHourlySettings,
  messageContent,
  forecastPageUrl,
  text,
  HOURLY_METRICS,
  HOURLY_SPANS,
} from '../src/widgets.js';
import { readAlerts } from '../src/alerts.js';
import { feature } from './helpers/alert-feature.js';
import { fixtures, NOW, LATITUDE, LONGITUDE, TIME_ZONE } from './helpers/fixtures.js';

const HOUSE = { name: 'Home', latitude: LATITUDE, longitude: LONGITUDE };
const LANGUAGES = ['en', 'fr'];
const ICONS = 'https://api.weather.gov/icons/land';

test('encodes an NWS icon in its image key, and only an NWS icon', () => {
  const cases = {
    [`${ICONS}/day/tsra_hi,40?size=medium`]: ['nws-day-tsraqhi-40', 'land/day/tsra_hi,40'],
    [`${ICONS}/night/skc`]: ['nws-night-skc', 'land/night/skc'],
    [`${ICONS}/night/rain_showers,30/tsra,60`]: [
      'nws-night-rainqshowers-30-tsra-60',
      'land/night/rain_showers,30/tsra,60',
    ],
  };
  Object.entries(cases).forEach(([url, [key, path]]) => {
    assert.equal(iconKey(url), key);
    assert.match(key, /^[a-z0-9][a-z0-9-]{0,63}$/);
    assert.equal(iconPathFromKey(key), path);
  });
  assert.equal(iconKey(`${ICONS}/day/mystery`), null);
  assert.equal(iconKey(`${ICONS}/day/skc/few/sct`), null);
  assert.equal(iconKey(null), null);
  [
    'nws-day',
    'nws-dusk-skc',
    'foo-day-skc',
    'nws-day-mystery',
    'nws-day-40',
    'nws-day-skc-40-50',
    'nws-day-skc-101',
    'nws-day-skc-few-sct',
    'nws-day-..qetc',
  ].forEach((key) => assert.equal(iconPathFromKey(key), null, key));
});

test('alerts widget: counters, then each alert with its full text', () => {
  const alerts = readAlerts(
    [
      feature({ id: 'tor' }),
      feature({ id: 'watch', event: 'Tornado Watch', severity: 'Severe' }),
      feature({ id: 'air', event: 'Air Quality Alert', severity: 'Unknown' }),
    ],
    NOW,
  );
  LANGUAGES.forEach((language) => {
    const content = buildAlertsWidget({
      alerts,
      house: HOUSE,
      place: 'Linn, KS',
      timeZone: TIME_ZONE,
      language,
    });
    assert.deepEqual(validateWidgetContent(content), [], language);
    const tiles = content.components.filter((component) => component.type === 'value');
    assert.deepEqual(
      tiles.map((tile) => tile.value),
      [1, 1, 1],
    );
    assert.equal(tiles[0].color, 'danger');
    const list = content.components.find((component) => component.type === 'card-list');
    assert.equal(list.items.length, 3);
    assert.equal(list.items[0].title, 'Tornado Warning');
    assert.equal(list.items[0].badge.color, 'danger');
    assert.match(list.items[0].description, /TAKE COVER NOW!/);
    assert.equal(list.items[0].links[0].url, forecastPageUrl(LATITUDE, LONGITUDE));
  });
  const french = buildAlertsWidget({
    alerts,
    house: HOUSE,
    place: null,
    timeZone: TIME_ZONE,
    language: 'fr',
  });
  const item = french.components.find((component) => component.type === 'card-list').items[0];
  assert.equal(item.subtitle, 'Tornade · jusqu’à ven. 18:45');
  assert.equal(item.badge.text, 'Alerte');
});

test('alerts widget: a calm state when nothing is in force', () => {
  const content = buildAlertsWidget({
    alerts: [],
    house: HOUSE,
    place: 'Linn, KS',
    timeZone: TIME_ZONE,
    language: 'en',
  });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[1].value, 0);
  assert.equal(content.components[1].color, 'success');
  assert.equal(content.components[2].text, text('noAlertBody', 'en'));
});

test('alerts widget: long texts and many alerts stay within the budget', () => {
  const alerts = readAlerts(
    Array.from({ length: 12 }, (_, index) =>
      feature({
        id: `a${index}`,
        description: 'x'.repeat(5000),
        event: `Very Long Event Name Number ${index} Warning With Extra Words`,
      }),
    ),
    NOW,
  );
  const content = buildAlertsWidget({
    alerts,
    house: HOUSE,
    place: 'Linn, KS',
    timeZone: TIME_ZONE,
    language: 'en',
  });
  assert.deepEqual(validateWidgetContent(content), []);
  const list = content.components.find((component) => component.type === 'card-list');
  assert.equal(list.items.length, 8);
  assert.equal(list.items[0].description.length, 2000);
});

test('forecast widget: the NWS narrative period by period', () => {
  const { forecast } = fixtures();
  LANGUAGES.forEach((language) => {
    [true, false].forEach((showIcons) => {
      const content = buildForecastWidget({
        forecast,
        house: HOUSE,
        place: 'Linn, KS',
        timeZone: TIME_ZONE,
        language,
        units: 'us',
        showIcons,
        now: NOW,
      });
      assert.deepEqual(validateWidgetContent(content), [], `${language} ${showIcons}`);
      const list = content.components.find((component) => component.type === 'card-list');
      assert.equal(list.items.length, 8);
      assert.equal(
        list.items.every((item) => 'image' in item),
        showIcons,
      );
    });
  });
  const english = buildForecastWidget({
    forecast,
    house: HOUSE,
    place: 'Linn, KS',
    timeZone: TIME_ZONE,
    language: 'en',
    units: 'us',
    showIcons: true,
    now: NOW,
  });
  assert.equal(english.components[0].text, 'Home · Linn, KS · updated 5:41 PM');
  const [tonight, saturday] = english.components[1].items;
  assert.equal(tonight.title, 'Tonight');
  assert.equal(tonight.subtitle, 'Clear · Low 63°F');
  assert.equal(tonight.image, 'nws-night-skc');
  assert.equal(saturday.title, 'Saturday');
  assert.match(saturday.description, /high near 87/);
});

test('forecast widget: a chance of rain badge from 20 %', () => {
  const { forecast } = fixtures();
  forecast.properties.periods[0].probabilityOfPrecipitation.value = 40;
  forecast.properties.periods[1].probabilityOfPrecipitation.value = 10;
  const content = buildForecastWidget({
    forecast,
    house: HOUSE,
    place: null,
    timeZone: TIME_ZONE,
    language: 'fr',
    units: 'us',
    showIcons: false,
    now: NOW,
  });
  const [first, second] = content.components[1].items;
  assert.deepEqual(first.badge, { text: '40 %', color: 'info' });
  assert.equal(second.badge, undefined);
});

test('names the periods in French', () => {
  const night = {
    name: 'Saturday Night',
    isDaytime: false,
    startTime: '2026-10-10T18:00:00-05:00',
  };
  assert.equal(periodTitle(night, '2026-10-09', 'en'), 'Saturday Night');
  assert.equal(periodTitle(night, '2026-10-09', 'fr'), 'Nuit de samedi');
  assert.equal(periodTitle({ ...night, isDaytime: true }, '2026-10-09', 'fr'), 'Samedi');
  assert.equal(periodTitle(night, '2026-10-10', 'fr'), 'Cette nuit');
  assert.equal(periodTitle({ ...night, isDaytime: true }, '2026-10-10', 'fr'), 'Aujourd’hui');
  const overnight = { name: 'Overnight', isDaytime: false, startTime: '2026-10-10T01:00:00-05:00' };
  assert.equal(periodTitle(overnight, '2026-10-10', 'fr'), 'Fin de nuit');
  assert.equal(periodTitle(overnight, '2026-10-10', 'en'), 'Overnight');
});

test('hourly widget: every metric, span, language and unit system fits', () => {
  const { hourly, grid } = fixtures();
  LANGUAGES.forEach((language) =>
    ['us', 'metric'].forEach((units) =>
      HOURLY_METRICS.forEach((metric) =>
        HOURLY_SPANS.forEach((hours) => {
          const content = buildHourlyWidget({
            hourly,
            grid,
            house: HOUSE,
            place: 'Linn, KS',
            timeZone: TIME_ZONE,
            language,
            units,
            settings: { metric, hours },
            now: NOW,
          });
          const label = `${language} ${units} ${metric} ${hours}`;
          assert.deepEqual(validateWidgetContent(content), [], label);
          const chart = content.components.find((component) => component.type === 'chart');
          assert.equal(chart.series[0].points.length, Number(hours), label);
        }),
      ),
    ),
  );
});

test('hourly widget: annotates the extremes of the temperature', () => {
  const { hourly, grid } = fixtures();
  const content = buildHourlyWidget({
    hourly,
    grid,
    house: HOUSE,
    place: 'Linn, KS',
    timeZone: TIME_ZONE,
    language: 'en',
    units: 'us',
    settings: {},
    now: NOW,
  });
  const [, now, high, low, chart] = content.components;
  assert.equal(now.value, 84);
  assert.equal(high.label.startsWith('High '), true);
  assert.ok(high.value >= low.value);
  assert.equal(chart.now_marker, true);
  assert.equal(chart.annotations.length, 2);
  assert.equal(chart.annotations[0].value, high.value);
});

test('hourly widget: wind without gusts, rain without amounts', () => {
  const { hourly } = fixtures();
  const wind = buildHourlyWidget({
    hourly,
    grid: null,
    house: HOUSE,
    place: null,
    timeZone: TIME_ZONE,
    language: 'en',
    units: 'us',
    settings: { metric: 'wind' },
    now: NOW,
  });
  assert.deepEqual(validateWidgetContent(wind), []);
  const chart = wind.components.find((component) => component.type === 'chart');
  assert.equal(chart.series.length, 1);
  assert.equal(chart.annotations, undefined);

  const rain = buildHourlyWidget({
    hourly,
    grid: null,
    house: HOUSE,
    place: null,
    timeZone: TIME_ZONE,
    language: 'fr',
    units: 'metric',
    settings: { metric: 'precipitation' },
    now: NOW,
  });
  assert.deepEqual(validateWidgetContent(rain), []);
  assert.equal(rain.components.filter((component) => component.type === 'value').length, 2);
});

test('hourly widget: the first rain is pointed at', () => {
  const { hourly, grid } = fixtures();
  hourly.properties.periods[3].probabilityOfPrecipitation.value = 70;
  const content = buildHourlyWidget({
    hourly,
    grid,
    house: HOUSE,
    place: null,
    timeZone: TIME_ZONE,
    language: 'en',
    units: 'us',
    settings: { metric: 'precipitation', hours: '12' },
    now: NOW,
  });
  const [, maxChance, first] = content.components;
  assert.equal(maxChance.value, 70);
  assert.equal(maxChance.color, 'primary');
  assert.equal(first.value, '9:00 PM');
  const chart = content.components.find((component) => component.type === 'chart');
  assert.equal(chart.annotations[0].label, '9:00 PM');
});

test('hourly widget: reads its settings with defaults', () => {
  assert.deepEqual(readHourlySettings(), { metric: 'temperature', hours: 24 });
  assert.deepEqual(readHourlySettings({ metric: 'wind', hours: '48' }), {
    metric: 'wind',
    hours: 48,
  });
  assert.deepEqual(readHourlySettings({ metric: 'uv', hours: 7 }), {
    metric: 'temperature',
    hours: 24,
  });
});

test('hourly widget: a message when no hour is left', () => {
  const content = buildHourlyWidget({
    hourly: { properties: { periods: [] } },
    grid: null,
    house: HOUSE,
    place: null,
    timeZone: TIME_ZONE,
    language: 'en',
    units: 'us',
    settings: {},
    now: NOW,
  });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components.length, 1);
  assert.equal(content.components[0].text, text('noForecast', 'en'));
});

test('hourly widget: hours without a temperature are left out', () => {
  const { hourly, grid } = fixtures();
  const settings = { metric: 'temperature', hours: '12' };
  const options = { grid, house: HOUSE, place: null, timeZone: TIME_ZONE, language: 'en' };
  hourly.properties.periods[1].temperature = null;
  const some = buildHourlyWidget({ ...options, hourly, units: 'us', settings, now: NOW });
  assert.deepEqual(validateWidgetContent(some), []);
  some.components
    .filter((component) => component.type === 'value')
    .forEach((component) => assert.ok(Number.isFinite(component.value)));

  hourly.properties.periods.forEach((period) => {
    period.temperature = null;
  });
  const none = buildHourlyWidget({ ...options, hourly, units: 'us', settings, now: NOW });
  assert.equal(none.components[0].text, text('noForecast', 'en'));
});

test('message contents are valid', () => {
  ['noHouse', 'outOfCoverage', 'noForecast'].forEach((key) =>
    LANGUAGES.forEach((language) =>
      assert.deepEqual(validateWidgetContent(messageContent(text(key, language), 300)), []),
    ),
  );
});
