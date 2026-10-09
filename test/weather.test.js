import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildWeather, buildDays, pairPeriods, createDaylight, placeName } from '../src/weather.js';
import { readGrid } from '../src/gridpoint.js';
import { readAlerts } from '../src/alerts.js';
import { fixtures, NOW, LATITUDE, LONGITUDE, TIME_ZONE } from './helpers/fixtures.js';

const OPTIONS = { latitude: LATITUDE, longitude: LONGITUDE, now: NOW };

/**
 * @description Build the weather of the fixtures.
 * @param {string} units - 'metric' or 'us'.
 * @param {object} [overrides] - Products to replace.
 * @returns {object} The pivot payload.
 * @example
 * build('us');
 */
function build(units, overrides = {}) {
  const f = fixtures();
  return buildWeather(
    {
      point: f.point,
      observation: f.observation.properties,
      hourly: f.hourly,
      forecast: units === 'us' ? f.forecast : f.forecastSi,
      grid: f.grid,
      alerts: readAlerts(f.alerts.features, NOW - 2 * 60 * 60 * 1000),
      ...overrides,
    },
    { ...OPTIONS, units },
  );
}

test('reads the current conditions from the station observation', () => {
  const weather = build('us');
  assert.equal(weather.datetime, '2026-10-09T22:35:00+00:00');
  assert.equal(weather.temperature, 86);
  assert.equal(weather.humidity, 29);
  assert.equal(weather.dew_point, 50);
  assert.equal(weather.pressure, 1011.9);
  assert.equal(weather.wind_direction, 190);
  assert.equal(weather.wind_speed, 8.1);
  assert.equal(weather.visibility, 10);
  assert.equal(weather.weather, 'clear');
  // 6:15 PM CDT, before the 6:58 PM sunset: still day, whatever the NWS
  // "night" period says.
  assert.equal(weather.is_day, true);
  assert.ok(weather.sunrise instanceof Date && weather.sunset instanceof Date);
  assert.equal(weather.uv_index, undefined);
});

test('converts everything to metric', () => {
  const weather = build('metric');
  assert.equal(weather.temperature, 30);
  assert.equal(weather.dew_point, 10);
  assert.equal(weather.wind_speed, 3.6);
  assert.equal(weather.visibility, 16.1);
  assert.equal(weather.hours[0].temperature, 28.9);
  assert.equal(weather.days[0].temperature_max, 31);
  assert.equal(weather.days[0].temperature_min, 18);
});

test('falls back to the running hour without an observation', () => {
  const weather = build('us', { observation: null });
  assert.equal(weather.temperature, weather.hours[0].temperature);
  assert.equal(weather.datetime, new Date(NOW).toISOString());
  assert.equal(weather.pressure, undefined);
});

test('builds 24 hours enriched with the grid', () => {
  const { hours } = build('us');
  assert.equal(hours.length, 24);
  const [first] = hours;
  assert.equal(first.datetime, '2026-10-09T18:00:00-05:00');
  assert.equal(first.temperature, 84);
  assert.equal(first.humidity, 34);
  assert.equal(first.precipitation_probability, 0);
  assert.equal(first.cloud_cover, 0);
  assert.equal(typeof first.wind_gust, 'number');
  assert.equal(typeof first.apparent_temperature, 'number');
  assert.equal(first.precipitation, 0);
  // 8 PM: after sunset.
  assert.equal(hours[2].is_day, false);
  hours.forEach((hour) => assert.ok(typeof hour.weather === 'string'));
});

test('builds the hours without the grid', () => {
  const { hours } = build('us', { grid: null });
  assert.equal(hours[0].wind_gust, undefined);
  assert.equal(hours[0].wind_speed, 15);
  assert.equal(hours[0].wind_direction, 180);
});

test('pairs the day and night periods into complete days', () => {
  const f = fixtures();
  const pairs = pairPeriods(f.forecast);
  assert.equal(pairs[0].date, '2026-10-09');
  assert.equal(pairs[0].day, null);
  const days = buildDays(f.forecast, readGrid(f.grid), {
    units: 'us',
    latitude: LATITUDE,
    longitude: LONGITUDE,
  });
  assert.equal(days.length, 6);
  const [saturday] = days;
  assert.equal(saturday.datetime, '2026-10-10T06:00:00-05:00');
  assert.equal(saturday.temperature_max, 87);
  assert.equal(saturday.temperature_min, 64);
  assert.equal(saturday.weather, 'clear');
  assert.equal(saturday.wind_speed, 20);
  assert.equal(saturday.wind_direction, 180);
  assert.ok(saturday.sunrise < saturday.sunset);
  assert.deepEqual(pairPeriods(null), []);
});

test('carries the alerts in the pivot format', () => {
  const { alerts } = build('us');
  assert.equal(alerts[0].event, 'Red Flag Warning');
  assert.equal(alerts[0].severity, 'severe');
  assert.equal(build('us', { alerts: [] }).alerts, undefined);
});

test('refuses a forecast with no hour to come', () => {
  assert.throws(() => build('us', { hourly: { properties: { periods: [] } } }), /no period/);
});

test('tells day from night with the sun', () => {
  const isDayAt = createDaylight(TIME_ZONE, LATITUDE, LONGITUDE);
  assert.equal(isDayAt(Date.parse('2026-10-09T18:00:00Z')), true);
  assert.equal(isDayAt(Date.parse('2026-10-10T03:00:00Z')), false);
  assert.equal(
    createDaylight('America/Anchorage', 71.29, -156.79)(Date.parse('2026-06-21T12:00:00Z')),
    undefined,
  );
});

test('names the place of a point', () => {
  assert.equal(placeName(fixtures().point), 'Linn, KS');
  assert.equal(placeName(null), null);
  assert.equal(
    placeName({ properties: { relativeLocation: { properties: { city: 'Hagåtña' } } } }),
    'Hagåtña',
  );
});
