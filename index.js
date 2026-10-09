// -----------------------------------------------------------------------------
// Entry point of the National Weather Service external integration.
//
// The NWS is the official weather service of the United States: free,
// keyless, with the official watches, warnings and advisories. This is a
// WEATHER integration (manifest `type: "weather"`, contract B.18): Gladys asks
// for the weather of a location, we answer in the pivot format, and the core
// feeds its dashboard widget, the chat assistant and the weather-alert scene
// triggers with it.
//
// On top of the weather provider:
//   - onSceneAction(key)       read-only cards: the alerts in force, the
//                              forecast of a day with the NWS narrative, the
//                              current conditions (see scene-actions.js);
//   - publishSceneEvent(key)   triggers "NWS alert issued" / "ended", with
//                              filters on the kind of alert (tornado,
//                              hurricane, heat…), its level (warning, watch,
//                              advisory) and its severity (alert-watcher.js);
//   - onWidgetGet(key)         three dashboard widgets: alerts, narrative
//                              forecast, next hours as a curve (widgets.js);
//   - requestWeatherRefresh()  and requestWidgetRefresh('alerts'): the alert
//                              watcher nudges the core on every change, so an
//                              alert reaches the scenes and the dashboard in
//                              seconds instead of the 30-minute floor.
// The watcher checks the houses on its own, hence `location: true` and
// getHouses() (see houses.js).
//
// Zero configuration: the NWS API needs no key. The optional contact goes in
// the User-Agent the NWS requires (see nws-api.js).
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { createNwsClient, buildUserAgent } from './src/nws-api.js';
import { buildWeather, placeName } from './src/weather.js';
import { readAlerts } from './src/alerts.js';
import { createHouseRegistry } from './src/houses.js';
import { createAlertWatcher } from './src/alert-watcher.js';
import {
  SCENE_ACTIONS,
  buildAlertsOutputs,
  buildForecastOutputs,
  buildCurrentOutputs,
} from './src/scene-actions.js';
import {
  WIDGETS,
  TTL_SECONDS,
  text,
  iconPathFromKey,
  messageContent,
  buildAlertsWidget,
  buildForecastWidget,
  buildHourlyWidget,
} from './src/widgets.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();

// Integration-scoped config, refreshed by the supervisor on every change.
let config = normalizeConfig();

// Language and unit system of the instance, as the core sent them in its last
// request. The scene actions and triggers have no request to read them from.
let preferences = { language: 'en', units: 'us' };

/**
 * @description Remember the language and units of the last request.
 * @param {object} options - { language, units }.
 * @example
 * rememberPreferences({ language: 'fr', units: 'metric' });
 */
function rememberPreferences({ language, units }) {
  preferences = { language: language || preferences.language, units: units || preferences.units };
}

const nws = createNwsClient({
  getUserAgent: () => buildUserAgent(version, config.contact),
  getCacheDuration: () => config.cacheDuration,
  logger,
});

const houses = createHouseRegistry({ fetchHouses: () => gladys.getHouses(), logger });

/**
 * @description Run an optional fetch: its failure costs detail, never the answer.
 * @param {Promise<any>} promise - The fetch.
 * @param {any} fallback - The value on failure.
 * @param {string} what - What is fetched, for the log.
 * @returns {Promise<any>} The value or the fallback.
 * @example
 * const grid = await optional(nws.getGridData(point), null, 'grid');
 */
async function optional(promise, fallback, what) {
  try {
    return await promise;
  } catch (err) {
    logger.warn(`NWS ${what} unavailable: ${err.message}`);
    return fallback;
  }
}

/**
 * @description Load every NWS product of a location and build the pivot weather.
 * @param {object} options - { latitude, longitude, units }.
 * @returns {Promise<object>} `{ weather, point, observation, forecast, hourly, grid, alerts }`.
 * @throws {OutOfCoverageError} Outside the United States (the provider loop of
 * the core then falls through to the next weather provider).
 * @example
 * const { weather } = await loadWeather({ latitude: 39.7456, longitude: -97.0892, units: 'us' });
 */
async function loadWeather({ latitude, longitude, units }) {
  const point = await nws.getPoint(latitude, longitude);
  const [hourly, forecast, grid, observation, features] = await Promise.all([
    nws.getHourlyForecast(point),
    optional(nws.getForecast(point, units), null, 'forecast'),
    optional(nws.getGridData(point), null, 'grid data'),
    optional(nws.getLatestObservation(point), null, 'observation'),
    optional(nws.getActiveAlerts(latitude, longitude), [], 'alerts'),
  ]);
  const alerts = readAlerts(features);
  const weather = buildWeather(
    { point, observation, hourly, forecast, grid, alerts },
    { units, latitude, longitude },
  );
  return { weather, point, observation, forecast, hourly, grid, alerts };
}

// --- Weather request: Gladys asks us for the weather of a location -----------
gladys.onWeatherGet(async ({ latitude, longitude, language, units }) => {
  rememberPreferences({ language, units });
  logger.debug(`onWeatherGet -> (${latitude}, ${longitude}) in ${units}`);
  const { weather } = await loadWeather({ latitude, longitude, units });
  return weather;
});

// --- Alert watcher -------------------------------------------------------------
const alertWatcher = createAlertWatcher({
  houses,
  loadAlerts: async (house) => {
    const point = await nws.getPoint(house.latitude, house.longitude);
    const features = await nws.getActiveAlerts(house.latitude, house.longitude, { fresh: true });
    return { alerts: readAlerts(features), timeZone: point.properties.timeZone ?? null };
  },
  publish: (key, data) => gladys.publishSceneEvent(key, data),
  onChange: (house) => {
    logger.info(`NWS alerts of house "${house.name}" changed: nudging Gladys`);
    // The fresh alerts are already in the client cache (the watcher just
    // fetched them): the re-pull lands on them.
    gladys.requestWeatherRefresh();
    gladys.requestWidgetRefresh(WIDGETS.ALERTS);
  },
  getLanguage: () => preferences.language,
  getIntervalMs: () => config.alertCheckInterval * 1000,
  logger,
});

// --- Scene actions -----------------------------------------------------------
// Read-only actions. Each targets a house of Gladys (the first located one
// when the "House" field is empty). Throwing fails the action only.

/**
 * @description Find the house a scene action or widget targets, reading the
 * houses once more when none is known yet.
 * @param {string|null|undefined} name - The "House" field.
 * @returns {Promise<object>} The house.
 * @example
 * const house = await resolveHouse('Home');
 */
async function resolveHouse(name) {
  if (houses.list().length === 0) {
    await houses.refresh();
  }
  return houses.resolve(name);
}

gladys.onSceneAction(SCENE_ACTIONS.GET_ALERTS, async (fields) => {
  const house = await resolveHouse(fields.house);
  const point = await nws.getPoint(house.latitude, house.longitude);
  const features = await nws.getActiveAlerts(house.latitude, house.longitude);
  return buildAlertsOutputs({
    alerts: readAlerts(features),
    house: house.name,
    timeZone: point.properties.timeZone ?? null,
    language: preferences.language,
  });
});

gladys.onSceneAction(SCENE_ACTIONS.GET_FORECAST, async (fields) => {
  const house = await resolveHouse(fields.house);
  const point = await nws.getPoint(house.latitude, house.longitude);
  const forecast = await nws.getForecast(point, preferences.units);
  return buildForecastOutputs({
    forecast,
    timeZone: point.properties.timeZone ?? null,
    house: house.name,
    ...preferences,
    day: fields.day,
  });
});

gladys.onSceneAction(SCENE_ACTIONS.GET_CURRENT, async (fields) => {
  const house = await resolveHouse(fields.house);
  const { weather, observation, point } = await loadWeather({
    latitude: house.latitude,
    longitude: house.longitude,
    units: preferences.units,
  });
  return buildCurrentOutputs({
    weather,
    observation,
    house: house.name,
    timeZone: point.properties.timeZone ?? null,
    ...preferences,
  });
});

// --- Dashboard widgets ---------------------------------------------------------

/**
 * @description Resolve the house and NWS grid of a widget, or the content
 * explaining why there is none (no located house, outside the United States).
 * @param {string} key - The widget key.
 * @param {object} settings - The widget settings.
 * @param {string} language - The user language.
 * @returns {Promise<{ house: object, point: object }|{ content: object }>} The context.
 * @example
 * const context = await widgetContext('alerts', settings, 'en');
 */
async function widgetContext(key, settings, language) {
  if (houses.list().length === 0) {
    await houses.refresh();
  }
  if (houses.list().length === 0) {
    return { content: messageContent(text('noHouse', language), TTL_SECONDS[key]) };
  }
  const house = houses.resolve(settings.house);
  try {
    const point = await nws.getPoint(house.latitude, house.longitude);
    return { house, point };
  } catch (err) {
    if (err.name === 'OutOfCoverageError') {
      return { content: messageContent(text('outOfCoverage', language), TTL_SECONDS[key]) };
    }
    throw err;
  }
}

gladys.onWidgetGet(WIDGETS.ALERTS, async ({ settings = {}, language, units }) => {
  rememberPreferences({ language, units });
  const context = await widgetContext(WIDGETS.ALERTS, settings, language);
  if (context.content) {
    return context.content;
  }
  const { house, point } = context;
  const features = await nws.getActiveAlerts(house.latitude, house.longitude);
  return buildAlertsWidget({
    alerts: readAlerts(features),
    house,
    place: placeName(point),
    timeZone: point.properties.timeZone ?? null,
    language,
  });
});

gladys.onWidgetGet(WIDGETS.FORECAST, async ({ settings = {}, language, units }) => {
  rememberPreferences({ language, units });
  const context = await widgetContext(WIDGETS.FORECAST, settings, language);
  if (context.content) {
    return context.content;
  }
  const { house, point } = context;
  return buildForecastWidget({
    forecast: await nws.getForecast(point, units),
    house,
    place: placeName(point),
    timeZone: point.properties.timeZone ?? null,
    language,
    units,
    showIcons: settings.show_icons !== false,
  });
});

gladys.onWidgetGet(WIDGETS.HOURLY, async ({ settings = {}, language, units }) => {
  rememberPreferences({ language, units });
  const context = await widgetContext(WIDGETS.HOURLY, settings, language);
  if (context.content) {
    return context.content;
  }
  const { house, point } = context;
  const [hourly, grid] = await Promise.all([
    nws.getHourlyForecast(point),
    optional(nws.getGridData(point), null, 'grid data'),
  ]);
  return buildHourlyWidget({
    hourly,
    grid,
    house,
    place: placeName(point),
    timeZone: point.properties.timeZone ?? null,
    language,
    units,
    settings,
  });
});

// Image keys encode the NWS icon they stand for (see widgets.js): the URL is
// rebuilt from validated pieces, so only an NWS icon can ever be fetched.
gladys.onWidgetGetImage(async (imageKey) => {
  const path = iconPathFromKey(imageKey);
  if (path === null) {
    throw new Error(`Unknown NWS icon key: ${imageKey}`);
  }
  return nws.getIcon(path);
});

// --- Configuration -----------------------------------------------------------
gladys.onConfigUpdated((rawConfig) => {
  config = normalizeConfig(rawConfig);
  // A shorter cache duration must take effect now.
  nws.clear();
  logger.info(
    `Configuration updated: cache ${config.cacheDuration} s, alerts checked every ${config.alertCheckInterval} s`,
  );
});

// --- Connection lifecycle ----------------------------------------------------
// No persistent connection to the NWS (plain HTTPS calls) and nothing to
// configure: the integration is "connected" as soon as it is up.
gladys.on('connected', async () => {
  try {
    config = normalizeConfig(await gladys.getConfig());
    nws.clear();
    await gladys.setConnectionStatus(true);
    await houses.refresh();
    alertWatcher.start();
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
  }
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  alertWatcher.stop();
});

// --- Startup -----------------------------------------------------------------
logger.info(`Starting the National Weather Service integration ${version}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
