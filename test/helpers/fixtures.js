// Real NWS answers for Linn, Kansas (39.7456, -97.0892), captured on
// 2026-10-09 around 23:10 UTC and trimmed to keep the repository small.
import { readFileSync } from 'node:fs';

const load = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));

export const NOW = Date.parse('2026-10-09T23:15:00Z');
export const LATITUDE = 39.7456;
export const LONGITUDE = -97.0892;
export const TIME_ZONE = 'America/Chicago';

/**
 * @description Fresh copies of the fixtures (tests may mutate them).
 * @returns {object} The NWS payloads.
 * @example
 * const { point, hourly } = fixtures();
 */
export function fixtures() {
  return {
    point: load('points'),
    forecast: load('forecast'),
    forecastSi: load('forecast-si'),
    hourly: load('hourly'),
    grid: load('grid'),
    stations: load('stations'),
    observation: load('observation'),
    alerts: load('alerts'),
  };
}
