import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  readDayOffset,
  buildAlertsOutputs,
  buildForecastOutputs,
  buildCurrentOutputs,
  MAX_DAY_OFFSET,
} from '../src/scene-actions.js';
import { readAlerts } from '../src/alerts.js';
import { buildWeather } from '../src/weather.js';
import { feature } from './helpers/alert-feature.js';
import { fixtures, NOW, LATITUDE, LONGITUDE, TIME_ZONE } from './helpers/fixtures.js';

test('reads the day offset, today by default', () => {
  assert.equal(readDayOffset('3'), 3);
  assert.equal(readDayOffset(undefined), 0);
  assert.equal(readDayOffset(String(MAX_DAY_OFFSET + 1)), 0);
  assert.equal(readDayOffset('1.5'), 0);
});

test('sums up the alerts in force', () => {
  const alerts = readAlerts(
    [
      feature({ id: 'watch', event: 'Tornado Watch', severity: 'Severe' }),
      feature({ id: 'tor' }),
      feature({ id: 'heat', event: 'Heat Advisory', severity: 'Moderate' }),
    ],
    NOW,
  );
  const outputs = buildAlertsOutputs({
    alerts,
    house: 'Home',
    timeZone: TIME_ZONE,
    language: 'en',
  });
  assert.equal(outputs.count, 3);
  assert.equal(outputs.has_warning, true);
  assert.equal(outputs.warnings, 1);
  assert.equal(outputs.watches, 1);
  assert.equal(outputs.advisories, 1);
  assert.equal(outputs.top_event, 'Tornado Warning');
  assert.equal(outputs.top_category, 'tornado');
  assert.equal(outputs.top_instruction, 'TAKE COVER NOW!');
  assert.equal(outputs.top_ends, 'Fri 6:45 PM');
  assert.equal(
    outputs.summary,
    '3 NWS alert(s) for Home: Tornado Warning, Tornado Watch, Heat Advisory. Most serious: Tornado Warning until Fri 6:45 PM.',
  );

  const none = buildAlertsOutputs({ alerts: [], house: 'Maison', timeZone: null, language: 'fr' });
  assert.equal(none.has_alert, false);
  assert.equal(none.top_event, null);
  assert.equal(none.summary, 'Aucune alerte NWS en cours pour Maison.');
});

test('gives the forecast of tomorrow with the NWS narrative', () => {
  const { forecast, forecastSi } = fixtures();
  const outputs = buildForecastOutputs({
    forecast,
    timeZone: TIME_ZONE,
    house: 'Home',
    language: 'en',
    units: 'us',
    day: '1',
    now: NOW,
  });
  assert.equal(outputs.date, '2026-10-10');
  assert.equal(outputs.name, 'Saturday');
  assert.equal(outputs.temperature_max, 87);
  assert.equal(outputs.temperature_min, 64);
  assert.equal(outputs.wind_speed, 20);
  assert.equal(outputs.wind_direction, 'S');
  assert.match(outputs.detailed_forecast, /high near 87/);
  assert.equal(outputs.summary, 'Weather tomorrow in Home: clear, high 87°F, low 64°F.');

  const metric = buildForecastOutputs({
    forecast: forecastSi,
    timeZone: TIME_ZONE,
    house: 'Maison',
    language: 'fr',
    units: 'metric',
    day: '1',
    now: NOW,
  });
  assert.equal(metric.name, 'samedi');
  assert.equal(metric.wind_speed, 35);
  assert.equal(metric.summary, 'Météo demain à Maison : ciel dégagé, max 31°C, min 18°C.');
});

test('gives tonight alone when the day period is over', () => {
  const outputs = buildForecastOutputs({
    forecast: fixtures().forecast,
    timeZone: TIME_ZONE,
    house: 'Home',
    language: 'en',
    units: 'us',
    day: '0',
    now: NOW,
  });
  assert.equal(outputs.name, 'Tonight');
  assert.equal(outputs.temperature_max, null);
  assert.equal(outputs.temperature_min, 63);
  assert.equal(outputs.detailed_forecast, null);
  assert.equal(outputs.summary, 'Weather today in Home: clear, low 63°F.');
});

test('refuses a day beyond the forecast', () => {
  assert.throws(
    () =>
      buildForecastOutputs({
        forecast: fixtures().forecast,
        timeZone: TIME_ZONE,
        house: 'Home',
        language: 'en',
        units: 'us',
        day: '6',
        now: NOW + 3 * 24 * 60 * 60 * 1000,
      }),
    /does not cover/,
  );
});

test('gives the current conditions measured by the station', () => {
  const f = fixtures();
  const weather = buildWeather(
    {
      point: f.point,
      observation: f.observation.properties,
      hourly: f.hourly,
      forecast: f.forecastSi,
      grid: f.grid,
    },
    { units: 'metric', latitude: LATITUDE, longitude: LONGITUDE, now: NOW },
  );
  const outputs = buildCurrentOutputs({
    weather,
    observation: f.observation.properties,
    house: 'Maison',
    timeZone: TIME_ZONE,
    language: 'fr',
    units: 'metric',
  });
  assert.equal(outputs.temperature, 30);
  assert.equal(outputs.wind_speed, 13);
  assert.equal(outputs.wind_direction, 'S');
  assert.equal(outputs.observed, true);
  assert.equal(outputs.station, 'Marysville Municipal Airport');
  assert.equal(outputs.observed_at, '17:35');
  assert.equal(
    outputs.summary,
    'À Maison : 30°C, ciel dégagé, humidité 29 %, vent 13 km/h (relevé de 17:35).',
  );

  const forecastOnly = buildCurrentOutputs({
    weather: { temperature: 70.4, weather: 'rain' },
    observation: null,
    house: 'Home',
    timeZone: TIME_ZONE,
    language: 'en',
    units: 'us',
  });
  assert.equal(forecastOnly.observed, false);
  assert.equal(forecastOnly.humidity, null);
  assert.equal(forecastOnly.summary, 'In Home: 70°F, rain (forecast).');
});
