// -----------------------------------------------------------------------------
// Client of the National Weather Service API (https://api.weather.gov).
//
// Free, keyless, but with two rules of its own:
//   - every request MUST carry a User-Agent identifying the application and a
//     way to contact its operator — requests without one are refused (403);
//   - a location is first resolved to a forecast office grid (/points), and
//     every forecast URL is read from that answer, never built by hand.
//
// What is fetched, and how long it is kept (in memory, per location):
//   /points/{lat},{lon}                 24 h   grid, stations URL, time zone
//   .../stations                        24 h   nearest observation stations
//   /stations/{id}/observations/latest  cache  current conditions
//   .../forecast/hourly                 cache  hour by hour, 156 hours
//   .../forecast[?units=si]             cache  day and night periods, 7 days
//   /gridpoints/{office}/{x},{y}        cache  raw grid: gusts, sky, amounts
//   /alerts/active?point={lat},{lon}    60 s   official alerts
// "cache" is the user's `cache_duration` (10 min by default).
//
// Concurrent calls for the same resource share one request. The NWS answers
// a 5xx now and then on the forecast endpoints ("Unexpected Problem"): one
// retry absorbs most of them.
// -----------------------------------------------------------------------------

const API_BASE = 'https://api.weather.gov';
const REQUEST_TIMEOUT_MS = 10000;
const RETRY_DELAY_MS = 1500;
const POINT_TTL_MS = 24 * 60 * 60 * 1000;
const ALERTS_TTL_MS = 60 * 1000;
const ICON_TTL_MS = 24 * 60 * 60 * 1000;
// Coordinates beyond 4 decimals are answered with a redirect by the NWS.
const COORDINATE_PRECISION = 4;
// An observation older than this is not "current conditions" any more.
const OBSERVATION_MAX_AGE_MS = 2 * 60 * 60 * 1000;
// How many of the nearest stations to try for a usable observation.
const MAX_STATIONS = 3;

/**
 * @description Error of an NWS request, carrying the HTTP status.
 */
class NwsError extends Error {
  /**
   * @param {string} message - The message.
   * @param {number} [status] - The HTTP status (0 for a network failure).
   */
  constructor(message, status = 0) {
    super(message);
    this.name = 'NwsError';
    this.status = status;
  }
}

/**
 * @description The location is outside the NWS coverage (the United States
 * and its territories). Thrown by /points with a 404.
 */
class OutOfCoverageError extends NwsError {
  constructor(latitude, longitude) {
    super(
      `The National Weather Service covers the United States only: no forecast for (${latitude}, ${longitude})`,
      404,
    );
    this.name = 'OutOfCoverageError';
  }
}

/**
 * @description Round a coordinate the way the NWS wants it.
 * @param {number} value - Latitude or longitude.
 * @returns {string} The coordinate with at most 4 decimals.
 * @example
 * formatCoordinate(39.745612); // -> '39.7456'
 */
function formatCoordinate(value) {
  return String(Number(value.toFixed(COORDINATE_PRECISION)));
}

/**
 * @description Build the User-Agent the NWS requires.
 * @param {string} version - The integration version.
 * @param {string} [contact] - The operator's contact (email), optional.
 * @returns {string} The User-Agent header.
 * @example
 * buildUserAgent('0.1.0', 'me@example.com');
 * // -> 'gladys-nws/0.1.0 (https://github.com/William-De71/gladys-nws, me@example.com)'
 */
function buildUserAgent(version, contact = '') {
  const parts = ['https://github.com/William-De71/gladys-nws'];
  if (contact) {
    parts.push(contact);
  }
  return `gladys-nws/${version} (${parts.join(', ')})`;
}

/**
 * @description Create the NWS client.
 * @param {object} options - Options.
 * @param {Function} [options.fetchImpl] - fetch implementation (for the tests).
 * @param {Function} options.getUserAgent - `() => string`, read on every request.
 * @param {Function} options.getCacheDuration - `() => number` in seconds, the
 * user's cache duration.
 * @param {Function} [options.now] - `() => number` in ms (for the tests).
 * @param {Function} [options.sleep] - `(ms) => Promise` (for the tests).
 * @param {object} [options.logger] - Logger with debug/warn.
 * @returns {object} The client.
 * @example
 * const nws = createNwsClient({ getUserAgent: () => ua, getCacheDuration: () => 600 });
 */
function createNwsClient({
  fetchImpl = globalThis.fetch,
  getUserAgent,
  getCacheDuration,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  logger = console,
}) {
  // url -> { value, expiresAt }
  const cache = new Map();
  // url -> Promise, the requests in flight
  const inFlight = new Map();

  /**
   * @description Send one GET, retried once on a 5xx or a network failure.
   * @param {string} url - The URL.
   * @param {string} accept - The Accept header.
   * @returns {Promise<Response>} The successful response.
   * @example
   * await request(url, 'application/geo+json');
   */
  async function request(url, accept) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) {
        await sleep(RETRY_DELAY_MS);
      }
      let response;
      try {
        response = await fetchImpl(url, {
          headers: { 'User-Agent': getUserAgent(), Accept: accept },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        lastError = new NwsError(`NWS request failed (${url}): ${err.message}`);
        continue;
      }
      if (response.ok) {
        return response;
      }
      let detail = '';
      try {
        const body = await response.json();
        detail = body.detail || body.title || '';
      } catch {
        // Not JSON: the status says enough.
      }
      lastError = new NwsError(
        `NWS answered ${response.status} for ${url}${detail ? `: ${detail}` : ''}`,
        response.status,
      );
      if (response.status < 500) {
        break;
      }
    }
    throw lastError;
  }

  /**
   * @description GET a resource through the cache and the in-flight map.
   * @param {string} url - The URL.
   * @param {number} ttlMs - How long to keep the answer (0: not cached).
   * @param {Function} [read] - `(response) => Promise<any>`, JSON by default.
   * @param {string} [accept] - The Accept header.
   * @returns {Promise<any>} The decoded answer.
   * @example
   * await cachedGet(url, 60000);
   */
  async function cachedGet(
    url,
    ttlMs,
    read = (response) => response.json(),
    accept = 'application/geo+json',
  ) {
    const entry = cache.get(url);
    if (entry !== undefined && entry.expiresAt > now()) {
      return entry.value;
    }
    if (inFlight.has(url)) {
      return inFlight.get(url);
    }
    const promise = (async () => {
      logger.debug(`GET ${url}`);
      const value = await read(await request(url, accept));
      if (ttlMs > 0) {
        cache.set(url, { value, expiresAt: now() + ttlMs });
      }
      return value;
    })();
    inFlight.set(url, promise);
    try {
      return await promise;
    } finally {
      inFlight.delete(url);
    }
  }

  const forecastTtl = () => Math.max(0, Number(getCacheDuration()) || 0) * 1000;

  /**
   * @description Resolve a location to its NWS grid.
   * @param {number} latitude - Latitude.
   * @param {number} longitude - Longitude.
   * @returns {Promise<object>} The /points payload.
   * @throws {OutOfCoverageError} Outside the United States.
   * @example
   * const point = await nws.getPoint(39.7456, -97.0892);
   */
  async function getPoint(latitude, longitude) {
    const url = `${API_BASE}/points/${formatCoordinate(latitude)},${formatCoordinate(longitude)}`;
    try {
      return await cachedGet(url, POINT_TTL_MS);
    } catch (err) {
      if (err.status === 404) {
        throw new OutOfCoverageError(latitude, longitude);
      }
      throw err;
    }
  }

  /**
   * @description The hourly forecast (always in US units: °F, mph).
   * @param {object} point - The /points payload.
   * @returns {Promise<object>} The /forecast/hourly payload.
   * @example
   * await nws.getHourlyForecast(point);
   */
  function getHourlyForecast(point) {
    return cachedGet(point.properties.forecastHourly, forecastTtl());
  }

  /**
   * @description The day and night periods, in the requested unit system: the
   * text of `detailedForecast` follows it ("low around 17" with km/h winds).
   * @param {object} point - The /points payload.
   * @param {string} units - 'metric' or 'us'.
   * @returns {Promise<object>} The /forecast payload.
   * @example
   * await nws.getForecast(point, 'metric');
   */
  function getForecast(point, units) {
    const url = point.properties.forecast + (units === 'us' ? '' : '?units=si');
    return cachedGet(url, forecastTtl());
  }

  /**
   * @description The raw forecast grid.
   * @param {object} point - The /points payload.
   * @returns {Promise<object>} The /gridpoints payload.
   * @example
   * await nws.getGridData(point);
   */
  function getGridData(point) {
    return cachedGet(point.properties.forecastGridData, forecastTtl());
  }

  /**
   * @description The latest usable observation among the nearest stations: a
   * station often reports `null` temperatures (sensor down, automated METAR
   * without the field), so the next one is tried.
   * @param {object} point - The /points payload.
   * @returns {Promise<object|null>} The observation properties, plus `stationName`,
   * or null when no recent observation exists.
   * @example
   * await nws.getLatestObservation(point);
   */
  async function getLatestObservation(point) {
    const stations = await cachedGet(point.properties.observationStations, POINT_TTL_MS);
    const identifiers = (stations.features ?? [])
      .map((feature) => feature?.properties?.stationIdentifier)
      .filter(Boolean)
      .slice(0, MAX_STATIONS);
    for (const identifier of identifiers) {
      try {
        const observation = await cachedGet(
          `${API_BASE}/stations/${encodeURIComponent(identifier)}/observations/latest`,
          Math.min(forecastTtl(), 10 * 60 * 1000),
        );
        const properties = observation?.properties;
        const age = now() - Date.parse(properties?.timestamp);
        if (typeof properties?.temperature?.value === 'number' && age < OBSERVATION_MAX_AGE_MS) {
          return properties;
        }
      } catch (err) {
        logger.debug(`No observation from station ${identifier}: ${err.message}`);
      }
    }
    return null;
  }

  /**
   * @description The official alerts in force at a location.
   * @param {number} latitude - Latitude.
   * @param {number} longitude - Longitude.
   * @param {object} [options] - Options.
   * @param {boolean} [options.fresh] - Bypass the 60 s cache (the alert watcher).
   * @returns {Promise<Array<object>>} The alert features.
   * @example
   * await nws.getActiveAlerts(39.7456, -97.0892);
   */
  async function getActiveAlerts(latitude, longitude, { fresh = false } = {}) {
    const url = `${API_BASE}/alerts/active?point=${formatCoordinate(latitude)},${formatCoordinate(longitude)}`;
    if (fresh) {
      cache.delete(url);
    }
    const payload = await cachedGet(url, ALERTS_TTL_MS);
    return Array.isArray(payload?.features) ? payload.features : [];
  }

  /**
   * @description Download a forecast icon (PNG).
   * @param {string} path - The icon path after /icons/ ("land/day/tsra_hi,40").
   * @returns {Promise<string>} Raw base64 of the PNG.
   * @example
   * await nws.getIcon('land/day/skc');
   */
  function getIcon(path) {
    return cachedGet(
      `${API_BASE}/icons/${path}?size=medium`,
      ICON_TTL_MS,
      async (response) => Buffer.from(await response.arrayBuffer()).toString('base64'),
      'image/png',
    );
  }

  /**
   * @description Forget every cached answer (configuration change).
   * @example
   * nws.clear();
   */
  function clear() {
    cache.clear();
  }

  return {
    getPoint,
    getHourlyForecast,
    getForecast,
    getGridData,
    getLatestObservation,
    getActiveAlerts,
    getIcon,
    clear,
  };
}

export {
  API_BASE,
  NwsError,
  OutOfCoverageError,
  OBSERVATION_MAX_AGE_MS,
  formatCoordinate,
  buildUserAgent,
  createNwsClient,
};
