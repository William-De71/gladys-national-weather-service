import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createNwsClient,
  buildUserAgent,
  formatCoordinate,
  OutOfCoverageError,
  NwsError,
} from '../src/nws-api.js';
import { fixtures, NOW } from './helpers/fixtures.js';

const silent = { debug() {}, info() {}, warn() {} };

/**
 * @description A fake fetch answering from a route table, recording the calls.
 * @param {object} routes - url -> body | { status, body } | Function.
 * @returns {Function} The fetch, with a `calls` array.
 * @example
 * const fetchImpl = fakeFetch({ 'https://…': { ok: 1 } });
 */
function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, headers: options.headers });
    let route = routes[url];
    if (typeof route === 'function') {
      route = route(calls.filter((call) => call.url === url).length);
    }
    if (route === undefined) {
      return new Response(JSON.stringify({ title: 'Not Found' }), { status: 404 });
    }
    if (route instanceof Error) {
      throw route;
    }
    const { status = 200, body = route } = route.__response ? route : { body: route };
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const reply = (status, body) => ({ __response: true, status, body });

/**
 * @description Create a client on a fake fetch.
 * @param {object} routes - The routes.
 * @param {object} [options] - Client options.
 * @returns {object} The client and its fetch.
 * @example
 * const { nws, fetchImpl } = client({});
 */
function client(routes, options = {}) {
  const fetchImpl = fakeFetch(routes);
  let clock = NOW;
  const nws = createNwsClient({
    fetchImpl,
    getUserAgent: () => 'gladys-national-weather-service/test (contact)',
    getCacheDuration: () => 600,
    now: () => clock,
    sleep: async () => {},
    logger: silent,
    ...options,
  });
  return { nws, fetchImpl, advance: (ms) => (clock += ms) };
}

const POINT_URL = 'https://api.weather.gov/points/39.7456,-97.0892';

test('identifies itself as the NWS requires', () => {
  assert.equal(
    buildUserAgent('0.1.0', 'me@example.com'),
    'gladys-national-weather-service/0.1.0 (https://github.com/William-De71/gladys-national-weather-service, me@example.com)',
  );
  assert.equal(
    buildUserAgent('0.1.0'),
    'gladys-national-weather-service/0.1.0 (https://github.com/William-De71/gladys-national-weather-service)',
  );
  assert.equal(formatCoordinate(39.745612), '39.7456');
  assert.equal(formatCoordinate(-97.1), '-97.1');
});

test('resolves a point once a day and sends the User-Agent', async () => {
  const { point } = fixtures();
  const { nws, fetchImpl, advance } = client({ [POINT_URL]: point });
  assert.deepEqual(await nws.getPoint(39.745612, -97.08921), point);
  await nws.getPoint(39.7456, -97.0892);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(
    fetchImpl.calls[0].headers['User-Agent'],
    'gladys-national-weather-service/test (contact)',
  );
  assert.equal(fetchImpl.calls[0].headers.Accept, 'application/geo+json');
  advance(25 * 60 * 60 * 1000);
  await nws.getPoint(39.7456, -97.0892);
  assert.equal(fetchImpl.calls.length, 2);
});

test('reports a location outside the United States', async () => {
  const { nws } = client({});
  await assert.rejects(nws.getPoint(48.85, 2.35), (err) => {
    assert.ok(err instanceof OutOfCoverageError);
    assert.equal(err.name, 'OutOfCoverageError');
    return true;
  });
});

test('retries once on a server error, never on a client error', async () => {
  const { point, hourly } = fixtures();
  const url = point.properties.forecastHourly;
  const { nws, fetchImpl } = client({
    [url]: (attempt) => (attempt === 1 ? reply(500, { detail: 'Unexpected Problem' }) : hourly),
  });
  assert.deepEqual(await nws.getHourlyForecast(point), hourly);
  assert.equal(fetchImpl.calls.length, 2);

  const failing = client({ [url]: reply(503, 'down') });
  await assert.rejects(failing.nws.getHourlyForecast(point), (err) => {
    assert.ok(err instanceof NwsError);
    assert.equal(err.status, 503);
    return true;
  });
  assert.equal(failing.fetchImpl.calls.length, 2);

  const refused = client({ [url]: reply(403, { title: 'Forbidden' }) });
  await assert.rejects(refused.nws.getHourlyForecast(point), /403.*Forbidden/);
  assert.equal(refused.fetchImpl.calls.length, 1);

  const offline = client({ [url]: new Error('ECONNRESET') });
  await assert.rejects(offline.nws.getHourlyForecast(point), /ECONNRESET/);
  assert.equal(offline.fetchImpl.calls.length, 2);
});

test('shares one request between concurrent callers and honors the cache duration', async () => {
  const { point, grid } = fixtures();
  let duration = 600;
  const { nws, fetchImpl, advance } = client(
    { [point.properties.forecastGridData]: grid },
    { getCacheDuration: () => duration },
  );
  await Promise.all([nws.getGridData(point), nws.getGridData(point)]);
  assert.equal(fetchImpl.calls.length, 1);
  advance(601 * 1000);
  await nws.getGridData(point);
  assert.equal(fetchImpl.calls.length, 2);
  duration = 0;
  nws.clear();
  await nws.getGridData(point);
  await nws.getGridData(point);
  assert.equal(fetchImpl.calls.length, 4);
});

test('asks for SI units for a metric forecast', async () => {
  const { point, forecast, forecastSi } = fixtures();
  const { nws } = client({
    [point.properties.forecast]: forecast,
    [`${point.properties.forecast}?units=si`]: forecastSi,
  });
  assert.equal((await nws.getForecast(point, 'us')).properties.periods[0].temperatureUnit, 'F');
  assert.equal((await nws.getForecast(point, 'metric')).properties.periods[0].temperatureUnit, 'C');
});

test('takes the observation of the first station that reported recently', async () => {
  const { point, stations, observation } = fixtures();
  const latest = (id) => `https://api.weather.gov/stations/${id}/observations/latest`;
  const empty = { properties: { ...observation.properties, temperature: { value: null } } };
  const { nws } = client({
    [point.properties.observationStations]: stations,
    [latest('KMYZ')]: empty,
    [latest('KCNK')]: reply(500, 'oops'),
    [latest('KHJH')]: observation,
  });
  const result = await nws.getLatestObservation(point);
  assert.equal(result.timestamp, observation.properties.timestamp);

  const stale = client({
    [point.properties.observationStations]: stations,
    [latest('KMYZ')]: observation,
  });
  stale.advance(3 * 60 * 60 * 1000);
  assert.equal(await stale.nws.getLatestObservation(point), null);
});

test('reads the alerts of a point, fresh when asked', async () => {
  const { alerts } = fixtures();
  const url = 'https://api.weather.gov/alerts/active?point=39.7456,-97.0892';
  const { nws, fetchImpl } = client({ [url]: alerts });
  assert.equal((await nws.getActiveAlerts(39.7456, -97.0892)).length, alerts.features.length);
  await nws.getActiveAlerts(39.7456, -97.0892);
  assert.equal(fetchImpl.calls.length, 1);
  await nws.getActiveAlerts(39.7456, -97.0892, { fresh: true });
  assert.equal(fetchImpl.calls.length, 2);

  const odd = client({ [url]: { type: 'FeatureCollection' } });
  assert.deepEqual(await odd.nws.getActiveAlerts(39.7456, -97.0892), []);
});

test('downloads an icon as raw base64', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const url = 'https://api.weather.gov/icons/land/day/skc?size=medium';
  const fetchImpl = async (requested, options) => {
    assert.equal(requested, url);
    assert.equal(options.headers.Accept, 'image/png');
    return new Response(png, { status: 200 });
  };
  const nws = createNwsClient({
    fetchImpl,
    getUserAgent: () => 'ua',
    getCacheDuration: () => 600,
    logger: silent,
  });
  assert.equal(await nws.getIcon('land/day/skc'), png.toString('base64'));
});
