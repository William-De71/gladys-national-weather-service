// -----------------------------------------------------------------------------
// Scene actions of the National Weather Service integration.
//
// Read-only cards of the scene editor, each targeting a house (the first
// located one when the "House" field is empty), each returning scalars for the
// following actions of the scene — a `summary` sentence ready to send in a
// message among them:
//   - get_alerts:    the official alerts in force, the most serious first;
//   - get_forecast:  the NWS forecast of a day, with its narrative text
//                    ("Sunny, with a high near 84. South wind 10 to 15 mph.");
//   - get_current:   the conditions measured at the nearest station.
//
// The NWS writes its texts in English only: the narrative outputs stay in
// English, every other output follows the language of the instance.
// -----------------------------------------------------------------------------

import { conditionLabel, readCondition } from './conditions.js';
import {
  CATEGORY_LABELS,
  LEVEL_LABELS,
  SEVERITY_LABELS,
  countByLevel,
  localize,
} from './alerts.js';
import { pairPeriods, quantity, percent } from './weather.js';
import { addDays, formatDayTime, formatTime, localDate, weekdayName } from './time.js';
import {
  convertTemperature,
  displaySpeed,
  degreesToCompass,
  parseWindSpeed,
  unitLabels,
} from './units.js';

const SCENE_ACTIONS = {
  GET_ALERTS: 'get_alerts',
  GET_FORECAST: 'get_forecast',
  GET_CURRENT: 'get_current',
};

// The NWS forecast covers 7 days: today (or tonight) and the 6 that follow.
const MAX_DAY_OFFSET = 6;

/**
 * @description Read the "day" field of get_forecast: an offset from 0 (today) to 6.
 * @param {unknown} value - The field value (a select, so a string).
 * @returns {number} The offset.
 * @example
 * readDayOffset('2'); // -> 2
 */
function readDayOffset(value) {
  const offset = Number(value ?? 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_DAY_OFFSET) {
    return 0;
  }
  return offset;
}

/**
 * @description Outputs of get_alerts.
 * @param {object} options - Options.
 * @param {Array<object>} options.alerts - The readAlerts() alerts (most serious first).
 * @param {string} options.house - The house name.
 * @param {string|null} options.timeZone - The time zone of the house.
 * @param {string} options.language - 'fr' or 'en'.
 * @returns {object} The outputs.
 * @example
 * buildAlertsOutputs({ alerts, house: 'Home', timeZone: 'America/Chicago', language: 'en' });
 */
function buildAlertsOutputs({ alerts, house, timeZone, language }) {
  const counts = countByLevel(alerts);
  const top = alerts[0] ?? null;
  const events = [...new Set(alerts.map((alert) => alert.event))].join(', ');
  let summary;
  if (top === null) {
    summary =
      language === 'fr'
        ? `Aucune alerte NWS en cours pour ${house}.`
        : `No NWS alert in force for ${house}.`;
  } else {
    const until = top.end ? formatDayTime(top.end, timeZone, language) : null;
    summary =
      language === 'fr'
        ? `${alerts.length} alerte(s) NWS pour ${house} : ${events}. La plus grave : ${top.event}${until ? ` jusqu'à ${until}` : ''}.`
        : `${alerts.length} NWS alert(s) for ${house}: ${events}. Most serious: ${top.event}${until ? ` until ${until}` : ''}.`;
  }
  return {
    count: alerts.length,
    has_alert: alerts.length > 0,
    has_warning: counts.warning > 0,
    warnings: counts.warning,
    watches: counts.watch,
    advisories: counts.advisory,
    events,
    top_event: top?.event ?? null,
    top_category: top?.category ?? null,
    top_category_label: top ? localize(CATEGORY_LABELS, top.category, language) : null,
    top_level: top?.level ?? null,
    top_level_label: top ? localize(LEVEL_LABELS, top.level, language) : null,
    top_severity: top?.severity ?? null,
    top_severity_label: top ? localize(SEVERITY_LABELS, top.severity, language) : null,
    top_headline: top?.headline ?? null,
    top_instruction: top?.instruction ?? null,
    top_ends: top?.end ? formatDayTime(top.end, timeZone, language) : null,
    summary,
  };
}

/**
 * @description Outputs of get_forecast.
 * @param {object} options - Options.
 * @param {object} options.forecast - The /forecast payload, in the requested units.
 * @param {string|null} options.timeZone - The time zone of the house.
 * @param {string} options.house - The house name.
 * @param {string} options.language - 'fr' or 'en'.
 * @param {string} options.units - 'metric' or 'us'.
 * @param {unknown} options.day - The "day" field.
 * @param {number} [options.now] - Current time in ms.
 * @returns {object} The outputs.
 * @throws {Error} When the forecast does not reach that day.
 * @example
 * buildForecastOutputs({ forecast, timeZone, house: 'Home', language: 'en', units: 'us', day: '1' });
 */
function buildForecastOutputs({
  forecast,
  timeZone,
  house,
  language,
  units,
  day,
  now = Date.now(),
}) {
  const offset = readDayOffset(day);
  const date = addDays(localDate(now, timeZone), offset);
  const entry = pairPeriods(forecast).find((candidate) => candidate.date === date);
  if (entry === undefined) {
    throw new Error(`The NWS forecast does not cover ${date}`);
  }
  const { day: daytime, night } = entry;
  const main = daytime ?? night;
  const condition = readCondition(main.icon, main.shortForecast);
  const temperatureMax = daytime
    ? convertTemperature(daytime.temperature, daytime.temperatureUnit, units)
    : null;
  const temperatureMin = night
    ? convertTemperature(night.temperature, night.temperatureUnit, units)
    : null;
  const chances = [daytime, night]
    .filter(Boolean)
    .map((period) => quantity(period.probabilityOfPrecipitation))
    .filter((value) => value !== undefined);
  const precipitationProbability = chances.length > 0 ? percent(Math.max(...chances)) : null;
  const wind = displaySpeed(parseWindSpeed(main.windSpeed, units), units) ?? null;
  const labels = unitLabels(units);
  const name =
    offset === 0
      ? language === 'fr'
        ? "aujourd'hui"
        : 'today'
      : offset === 1
        ? language === 'fr'
          ? 'demain'
          : 'tomorrow'
        : weekdayName(date, language);

  const parts = [];
  if (language === 'fr') {
    parts.push(`Météo ${name} à ${house} : ${conditionLabel(condition, 'fr').toLowerCase()}`);
    if (temperatureMax !== null)
      parts.push(`max ${Math.round(temperatureMax)}${labels.temperature}`);
    if (temperatureMin !== null)
      parts.push(`min ${Math.round(temperatureMin)}${labels.temperature}`);
    if (precipitationProbability) parts.push(`${precipitationProbability} % de risque de pluie`);
  } else {
    parts.push(`Weather ${name} in ${house}: ${conditionLabel(condition, 'en').toLowerCase()}`);
    if (temperatureMax !== null)
      parts.push(`high ${Math.round(temperatureMax)}${labels.temperature}`);
    if (temperatureMin !== null)
      parts.push(`low ${Math.round(temperatureMin)}${labels.temperature}`);
    if (precipitationProbability) parts.push(`${precipitationProbability}% chance of rain`);
  }

  return {
    date,
    name: language === 'en' && main.name ? main.name : weekdayName(date, language),
    condition,
    condition_label: conditionLabel(condition, language),
    short_forecast: main.shortForecast ?? null,
    temperature_max: temperatureMax,
    temperature_min: temperatureMin,
    precipitation_probability: precipitationProbability,
    wind_speed: wind,
    wind_direction: main.windDirection || null,
    detailed_forecast: daytime?.detailedForecast || null,
    detailed_forecast_night: night?.detailedForecast || null,
    summary: `${parts.join(', ')}.`,
  };
}

/**
 * @description Outputs of get_current, from the pivot current conditions.
 * @param {object} options - Options.
 * @param {object} options.weather - The pivot payload.
 * @param {object|null} options.observation - The observation properties (null: forecast only).
 * @param {string} options.house - The house name.
 * @param {string|null} options.timeZone - The time zone of the house.
 * @param {string} options.language - 'fr' or 'en'.
 * @param {string} options.units - 'metric' or 'us'.
 * @returns {object} The outputs.
 * @example
 * buildCurrentOutputs({ weather, observation, house: 'Home', timeZone, language: 'en', units: 'us' });
 */
function buildCurrentOutputs({ weather, observation, house, timeZone, language, units }) {
  const labels = unitLabels(units);
  const windSpeed = displaySpeed(weather.wind_speed, units) ?? null;
  const windGust = displaySpeed(weather.wind_gust, units) ?? null;
  const direction = degreesToCompass(weather.wind_direction) ?? null;
  const temperature = Math.round(weather.temperature);
  const label = conditionLabel(weather.weather, language).toLowerCase();
  const observedAt = observation?.timestamp
    ? formatTime(observation.timestamp, timeZone, language)
    : null;

  let summary;
  if (language === 'fr') {
    summary = `À ${house} : ${temperature}${labels.temperature}, ${label}`;
    if (weather.humidity !== undefined) summary += `, humidité ${weather.humidity} %`;
    if (windSpeed !== null) summary += `, vent ${windSpeed} ${labels.speed}`;
    summary += observedAt ? ` (relevé de ${observedAt}).` : ' (prévision).';
  } else {
    summary = `In ${house}: ${temperature}${labels.temperature}, ${label}`;
    if (weather.humidity !== undefined) summary += `, humidity ${weather.humidity}%`;
    if (windSpeed !== null) summary += `, wind ${windSpeed} ${labels.speed}`;
    summary += observedAt ? ` (observed at ${observedAt}).` : ' (forecast).';
  }

  return {
    temperature: weather.temperature,
    apparent_temperature: weather.apparent_temperature ?? null,
    humidity: weather.humidity ?? null,
    dew_point: weather.dew_point ?? null,
    pressure: weather.pressure ?? null,
    wind_speed: windSpeed,
    wind_gust: windGust,
    wind_direction: direction,
    visibility: weather.visibility ?? null,
    condition: weather.weather,
    condition_label: conditionLabel(weather.weather, language),
    observed: observation !== null,
    station: observation?.stationName ?? null,
    observed_at: observedAt,
    summary,
  };
}

export {
  SCENE_ACTIONS,
  MAX_DAY_OFFSET,
  readDayOffset,
  buildAlertsOutputs,
  buildForecastOutputs,
  buildCurrentOutputs,
};
