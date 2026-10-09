import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  temperatureFromCelsius,
  temperatureFromFahrenheit,
  convertTemperature,
  speedFromKmh,
  speedFromMph,
  parseWindSpeed,
  compassToDegrees,
  degreesToCompass,
  pressureFromPascal,
  distanceFromMeters,
  precipitationFromMm,
  displaySpeed,
} from '../src/units.js';

test('converts temperatures both ways', () => {
  assert.equal(temperatureFromCelsius(20, 'us'), 68);
  assert.equal(temperatureFromCelsius(20, 'metric'), 20);
  assert.equal(temperatureFromFahrenheit(68, 'metric'), 20);
  assert.equal(temperatureFromFahrenheit(63, 'us'), 63);
  assert.equal(convertTemperature(17, 'C', 'us'), 62.6);
  assert.equal(convertTemperature(63, 'F', 'metric'), 17.2);
  assert.equal(temperatureFromCelsius(null, 'us'), undefined);
});

test('converts speeds to m/s in metric and mph in us', () => {
  assert.equal(speedFromKmh(36, 'metric'), 10);
  assert.equal(speedFromKmh(16.09344, 'us'), 10);
  assert.equal(speedFromMph(10, 'metric'), 4.5);
  assert.equal(speedFromMph(10, 'us'), 10);
  assert.equal(speedFromKmh(undefined, 'us'), undefined);
});

test('reads the wind of the text products, a range as its upper bound', () => {
  assert.equal(parseWindSpeed('15 mph', 'us'), 15);
  assert.equal(parseWindSpeed('10 to 15 mph', 'us'), 15);
  assert.equal(parseWindSpeed('20 to 25 km/h', 'metric'), 6.9);
  assert.equal(parseWindSpeed('20 to 25 km/h', 'us'), 15.5);
  assert.equal(parseWindSpeed('', 'us'), undefined);
  assert.equal(parseWindSpeed(null, 'us'), undefined);
});

test('converts compass points and degrees', () => {
  assert.equal(compassToDegrees('N'), 0);
  assert.equal(compassToDegrees('SW'), 225);
  assert.equal(compassToDegrees('ssw'), 202.5);
  assert.equal(compassToDegrees('nowhere'), undefined);
  assert.equal(degreesToCompass(190), 'S');
  assert.equal(degreesToCompass(359), 'N');
  assert.equal(degreesToCompass(-45), 'NW');
  assert.equal(degreesToCompass(null), undefined);
});

test('converts pressure, distance and precipitation', () => {
  assert.equal(pressureFromPascal(101190), 1011.9);
  assert.equal(distanceFromMeters(16090, 'metric'), 16.1);
  assert.equal(distanceFromMeters(16093.44, 'us'), 10);
  assert.equal(precipitationFromMm(25.4, 'us'), 1);
  assert.equal(precipitationFromMm(3.14, 'metric'), 3.1);
});

test('displays the pivot wind in km/h or mph', () => {
  assert.equal(displaySpeed(10, 'metric'), 36);
  assert.equal(displaySpeed(15.4, 'us'), 15);
  assert.equal(displaySpeed(undefined, 'us'), undefined);
});
