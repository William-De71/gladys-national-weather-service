// -----------------------------------------------------------------------------
// NWS products -> the Gladys pivot weather format (contract B.18).
//
// Four NWS products are merged, each for what it does best:
//   - the latest OBSERVATION of the nearest station: the current conditions
//     (measured, not forecast) — temperature, humidity, pressure, wind,
//     visibility, feels-like;
//   - the HOURLY forecast: the `hours`, and the current conditions when no
//     station reported recently;
//   - the day/night FORECAST periods: the `days` (high of the day period, low
//     of the night that follows, as the NWS pairs them);
//   - the raw GRID: what the text products leave out — gusts, cloud cover,
//     feels-like and precipitation amounts — matched to each hour and day.
//     The grid is optional: when it fails, the payload just has less detail.
// Sunrise and sunset are computed locally (sun.js); the alerts come from
// alerts.js. The NWS publishes no UV index: the field is left out.
// -----------------------------------------------------------------------------

import { readCondition, isDayFromIcon } from './conditions.js';
import { readGrid, valueAt, maxOver, sumOver, HOUR_MS } from './gridpoint.js';
import { sunTimes } from './sun.js';
import { localDate, periodDate } from './time.js';
import {
  isNumber,
  temperatureFromCelsius,
  convertTemperature,
  speedFromKmh,
  parseWindSpeed,
  compassToDegrees,
  pressureFromPascal,
  distanceFromMeters,
  precipitationFromMm,
} from './units.js';
import { toPivotAlerts } from './alerts.js';

const MAX_HOURS = 24;
const MAX_DAYS = 8;

/**
 * @description Drop the undefined and null fields of an object.
 * @param {object} object - The object.
 * @returns {object} The same object without empty fields.
 * @example
 * compact({ a: 1, b: undefined }); // -> { a: 1 }
 */
function compact(object) {
  Object.keys(object).forEach((key) => {
    if (object[key] === undefined || object[key] === null) {
      delete object[key];
    }
  });
  return object;
}

/**
 * @description The value of a WMO quantity ({ unitCode, value }), or undefined.
 * @param {object|undefined} quantity - The quantity.
 * @returns {number|undefined} The value.
 * @example
 * quantity({ unitCode: 'wmoUnit:degC', value: 30 }); // -> 30
 */
function quantity(quantity) {
  return isNumber(quantity?.value) ? quantity.value : undefined;
}

/**
 * @description Clamp a percentage to 0-100, rounded.
 * @param {number|undefined} value - The percentage.
 * @returns {number|undefined} The clamped value.
 * @example
 * percent(101.4); // -> 100
 */
function percent(value) {
  return isNumber(value) ? Math.min(100, Math.max(0, Math.round(value))) : undefined;
}

/**
 * @description The periods of a text product still running or to come.
 * @param {object|null} product - A /forecast or /forecast/hourly payload.
 * @param {number} now - Current time in ms.
 * @returns {Array<object>} The periods whose end is after now.
 * @example
 * upcomingPeriods(hourly, Date.now());
 */
function upcomingPeriods(product, now) {
  const periods = product?.properties?.periods;
  if (!Array.isArray(periods)) {
    return [];
  }
  return periods.filter((period) => Date.parse(period.endTime) > now);
}

/**
 * @description Build one pivot hour.
 * @param {object} period - An hourly period.
 * @param {object} layers - The readGrid() layers.
 * @param {string} units - 'metric' or 'us'.
 * @returns {object} The pivot hour.
 * @example
 * buildHour(period, layers, 'metric');
 */
function buildHour(period, layers, units) {
  const start = Date.parse(period.startTime);
  const gridSpeed = valueAt(layers.windSpeed, start);
  const gridDirection = valueAt(layers.windDirection, start);
  const humidity = quantity(period.relativeHumidity) ?? valueAt(layers.relativeHumidity, start);
  return compact({
    datetime: period.startTime,
    temperature: convertTemperature(period.temperature, period.temperatureUnit, units),
    weather: readCondition(period.icon, period.shortForecast),
    is_day: typeof period.isDaytime === 'boolean' ? period.isDaytime : isDayFromIcon(period.icon),
    apparent_temperature: temperatureFromCelsius(valueAt(layers.apparentTemperature, start), units),
    humidity: percent(humidity),
    wind_speed:
      gridSpeed !== undefined
        ? speedFromKmh(gridSpeed, units)
        : parseWindSpeed(period.windSpeed, units),
    wind_direction: gridDirection ?? compassToDegrees(period.windDirection),
    wind_gust: speedFromKmh(valueAt(layers.windGust, start), units),
    cloud_cover: percent(valueAt(layers.skyCover, start)),
    precipitation: precipitationFromMm(
      sumOver(layers.quantitativePrecipitation, start, start + HOUR_MS),
      units,
    ),
    precipitation_probability: percent(quantity(period.probabilityOfPrecipitation)),
  });
}

/**
 * @description Pair the day and night periods of the forecast by local date.
 * @param {object|null} forecast - The /forecast payload.
 * @returns {Array<{ date: string, day: object|null, night: object|null }>}
 * One entry per local date, in order.
 * @example
 * pairPeriods(forecast);
 */
function pairPeriods(forecast) {
  const periods = forecast?.properties?.periods;
  if (!Array.isArray(periods)) {
    return [];
  }
  const byDate = new Map();
  periods.forEach((period) => {
    const date = periodDate(period.startTime);
    if (!byDate.has(date)) {
      byDate.set(date, { date, day: null, night: null });
    }
    byDate.get(date)[period.isDaytime ? 'day' : 'night'] = period;
  });
  return [...byDate.values()];
}

/**
 * @description Build the pivot days: a date counts once it has both its day
 * period (the high) and its night period (the low). "Tonight", alone at the
 * head of an evening forecast, and the last day, whose night is beyond the
 * forecast, are left out — consumers filter by date anyway.
 * @param {object|null} forecast - The /forecast payload (in the requested units).
 * @param {object} layers - The readGrid() layers.
 * @param {object} options - { units, latitude, longitude }.
 * @returns {Array<object>} The pivot days.
 * @example
 * buildDays(forecast, layers, { units: 'metric', latitude: 39.7, longitude: -97.1 });
 */
function buildDays(forecast, layers, { units, latitude, longitude }) {
  return pairPeriods(forecast)
    .filter(({ day, night }) => day !== null && night !== null)
    .slice(0, MAX_DAYS)
    .map(({ date, day, night }) => {
      const from = Date.parse(day.startTime);
      const to = Date.parse(night.endTime);
      const chances = [day, night]
        .map((period) => quantity(period.probabilityOfPrecipitation))
        .filter(isNumber);
      const sun = sunTimes(date, latitude, longitude);
      return compact({
        // The start of the day period, not the bare date: a bare date reads as
        // UTC midnight, the evening BEFORE in every American time zone.
        datetime: day.startTime,
        temperature_max: convertTemperature(day.temperature, day.temperatureUnit, units),
        temperature_min: convertTemperature(night.temperature, night.temperatureUnit, units),
        weather: readCondition(day.icon, day.shortForecast),
        precipitation_probability: chances.length > 0 ? percent(Math.max(...chances)) : undefined,
        precipitation: precipitationFromMm(
          sumOver(layers.quantitativePrecipitation, from, to),
          units,
        ),
        wind_speed: parseWindSpeed(day.windSpeed, units),
        wind_direction: compassToDegrees(day.windDirection),
        wind_gust: speedFromKmh(maxOver(layers.windGust, from, to), units),
        sunrise: sun?.sunrise,
        sunset: sun?.sunset,
      });
    });
}

/**
 * @description Build the current conditions, the station observation first,
 * the forecast of the running hour for whatever the station did not report.
 * @param {object|null} observation - The observation properties (null: none recent).
 * @param {object|null} currentHour - The pivot hour running now.
 * @param {object} layers - The readGrid() layers.
 * @param {object} options - { units, now }.
 * @returns {object} The current fields of the pivot payload.
 * @example
 * buildCurrent(observation, hours[0], layers, { units: 'us', now: Date.now() });
 */
function buildCurrent(observation, currentHour, layers, { units, now }) {
  const hour = currentHour ?? {};
  const observed = observation ?? {};
  const observedCondition =
    observation === null ? 'unknown' : readCondition(observed.icon, observed.textDescription);
  const feelsLike =
    quantity(observed.heatIndex) ??
    quantity(observed.windChill) ??
    valueAt(layers.apparentTemperature, now);

  return compact({
    datetime: observation?.timestamp ?? new Date(now).toISOString(),
    temperature: temperatureFromCelsius(quantity(observed.temperature), units) ?? hour.temperature,
    weather: observedCondition !== 'unknown' ? observedCondition : (hour.weather ?? 'unknown'),
    is_day: hour.is_day ?? isDayFromIcon(observed.icon),
    apparent_temperature: temperatureFromCelsius(feelsLike, units) ?? hour.apparent_temperature,
    humidity: percent(quantity(observed.relativeHumidity)) ?? hour.humidity,
    dew_point: temperatureFromCelsius(quantity(observed.dewpoint), units),
    pressure: pressureFromPascal(
      quantity(observed.seaLevelPressure) ?? quantity(observed.barometricPressure),
    ),
    wind_speed: speedFromKmh(quantity(observed.windSpeed), units) ?? hour.wind_speed,
    wind_direction: quantity(observed.windDirection) ?? hour.wind_direction,
    wind_gust: speedFromKmh(quantity(observed.windGust), units) ?? hour.wind_gust,
    visibility: distanceFromMeters(quantity(observed.visibility), units),
    cloud_cover: percent(valueAt(layers.skyCover, now)) ?? hour.cloud_cover,
  });
}

/**
 * @description Build a "is the sun up at this instant" function for a place,
 * computing the sun times once per local date.
 * @param {string|null} timeZone - The time zone of the place.
 * @param {number} latitude - Latitude.
 * @param {number} longitude - Longitude.
 * @returns {Function} `(instant) => boolean|undefined` (undefined: polar day or night).
 * @example
 * const isDayAt = createDaylight('America/Chicago', 39.7, -97.1);
 */
function createDaylight(timeZone, latitude, longitude) {
  const byDate = new Map();
  return (instant) => {
    const date = localDate(instant, timeZone);
    if (!byDate.has(date)) {
      byDate.set(date, sunTimes(date, latitude, longitude));
    }
    const sun = byDate.get(date);
    if (sun === null) {
      return undefined;
    }
    return instant >= sun.sunrise.getTime() && instant < sun.sunset.getTime();
  };
}

/**
 * @description Build the pivot weather payload of a location.
 * @param {object} products - The NWS products.
 * @param {object} products.point - The /points payload.
 * @param {object|null} products.observation - The latest observation properties.
 * @param {object|null} products.hourly - The /forecast/hourly payload (null when unavailable).
 * @param {object|null} products.forecast - The /forecast payload, in the requested units.
 * @param {object|null} products.grid - The /gridpoints payload.
 * @param {Array<object>} products.alerts - The readAlerts() alerts.
 * @param {object} options - Options.
 * @param {string} options.units - 'metric' or 'us'.
 * @param {number} options.latitude - Latitude of the house.
 * @param {number} options.longitude - Longitude of the house.
 * @param {number} [options.now] - Current time in ms.
 * @returns {object} The pivot payload.
 * @throws {Error} When neither the observation nor the hourly forecast gives
 * a current temperature.
 * @example
 * const weather = buildWeather(products, { units: 'metric', latitude, longitude });
 */
function buildWeather(
  { point, observation, hourly, forecast, grid, alerts = [] },
  { units, latitude, longitude, now = Date.now() },
) {
  const layers = readGrid(grid);
  const isDayAt = createDaylight(point?.properties?.timeZone ?? null, latitude, longitude);
  const hours = upcomingPeriods(hourly, now)
    .slice(0, MAX_HOURS)
    .map((period) => {
      const hour = buildHour(period, layers, units);
      // The NWS flags 6 AM-6 PM as "daytime" whatever the season: the real
      // sun times give the right day/night icon at dusk and dawn.
      hour.is_day = isDayAt(Date.parse(period.startTime)) ?? hour.is_day;
      return hour;
    });
  // No hour to come (hourly forecast unavailable or stale): the current
  // conditions rest on the observation alone, and the payload has no hours.
  const weather = buildCurrent(observation, hours[0] ?? null, layers, { units, now });
  if (!isNumber(weather.temperature)) {
    throw new Error('The NWS published no current temperature');
  }
  weather.is_day = isDayAt(now) ?? weather.is_day;

  const today = sunTimes(localDate(now, point?.properties?.timeZone), latitude, longitude);
  if (today !== null) {
    weather.sunrise = today.sunrise;
    weather.sunset = today.sunset;
  }

  if (hours.length > 0) {
    weather.hours = hours;
  }
  const days = buildDays(forecast, layers, { units, latitude, longitude });
  if (days.length > 0) {
    weather.days = days;
  }
  const pivotAlerts = toPivotAlerts(alerts);
  if (pivotAlerts.length > 0) {
    weather.alerts = pivotAlerts;
  }
  return weather;
}

/**
 * @description The place name of a /points answer: "Linn, KS".
 * @param {object|null} point - The /points payload.
 * @returns {string|null} The city and state, or null.
 * @example
 * placeName(point); // -> 'Linn, KS'
 */
function placeName(point) {
  const location = point?.properties?.relativeLocation?.properties;
  if (!location?.city) {
    return null;
  }
  return location.state ? `${location.city}, ${location.state}` : location.city;
}

export {
  MAX_HOURS,
  compact,
  quantity,
  percent,
  upcomingPeriods,
  buildHour,
  pairPeriods,
  buildDays,
  buildCurrent,
  createDaylight,
  buildWeather,
  placeName,
};
