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
import { inSentence } from './i18n.js';

const SCENE_ACTIONS = {
  GET_ALERTS: 'get_alerts',
  GET_FORECAST: 'get_forecast',
  GET_CURRENT: 'get_current',
};

// The NWS forecast covers 7 days: today (or tonight) and the 6 that follow.
const MAX_DAY_OFFSET = 6;

// The `summary` sentences, per language (English for any other).
const SENTENCES = {
  en: {
    noAlert: ({ house }) => `No NWS alert in force for ${house}.`,
    alerts: ({ count, house, events, top, until }) =>
      `${count} NWS alert(s) for ${house}: ${events}. Most serious: ${top}${until ? ` until ${until}` : ''}.`,
    today: 'today',
    tomorrow: 'tomorrow',
    forecast: ({ name, house, sky }) => `Weather ${name} in ${house}: ${sky}`,
    high: (value) => `high ${value}`,
    low: (value) => `low ${value}`,
    rain: (value) => `${value}% chance of rain`,
    current: ({ house, temperature, sky }) => `In ${house}: ${temperature}, ${sky}`,
    humidity: (value) => `humidity ${value}%`,
    wind: (value) => `wind ${value}`,
    observed: (time) => ` (observed at ${time}).`,
    forecasted: ' (forecast).',
  },
  fr: {
    noAlert: ({ house }) => `Aucune alerte NWS en cours pour ${house}.`,
    alerts: ({ count, house, events, top, until }) =>
      `${count} alerte(s) NWS pour ${house} : ${events}. La plus grave : ${top}${until ? ` jusqu'à ${until}` : ''}.`,
    today: "aujourd'hui",
    tomorrow: 'demain',
    forecast: ({ name, house, sky }) => `Météo ${name} à ${house} : ${sky}`,
    high: (value) => `max ${value}`,
    low: (value) => `min ${value}`,
    rain: (value) => `${value} % de risque de pluie`,
    current: ({ house, temperature, sky }) => `À ${house} : ${temperature}, ${sky}`,
    humidity: (value) => `humidité ${value} %`,
    wind: (value) => `vent ${value}`,
    observed: (time) => ` (relevé de ${time}).`,
    forecasted: ' (prévision).',
  },
  de: {
    noAlert: ({ house }) => `Keine NWS-Warnung aktiv für ${house}.`,
    alerts: ({ count, house, events, top, until }) =>
      `${count} NWS-Warnung(en) für ${house}: ${events}. Die schwerste: ${top}${until ? ` bis ${until}` : ''}.`,
    today: 'heute',
    tomorrow: 'morgen',
    forecast: ({ name, house, sky }) => `Wetter ${name} in ${house}: ${sky}`,
    high: (value) => `Höchstwert ${value}`,
    low: (value) => `Tiefstwert ${value}`,
    rain: (value) => `${value} % Regenwahrscheinlichkeit`,
    current: ({ house, temperature, sky }) => `In ${house}: ${temperature}, ${sky}`,
    humidity: (value) => `Luftfeuchtigkeit ${value} %`,
    wind: (value) => `Wind ${value}`,
    observed: (time) => ` (gemessen um ${time}).`,
    forecasted: ' (Vorhersage).',
  },
  es: {
    noAlert: ({ house }) => `Ninguna alerta NWS en vigor para ${house}.`,
    alerts: ({ count, house, events, top, until }) =>
      `${count} alerta(s) NWS para ${house}: ${events}. La más grave: ${top}${until ? ` hasta ${until}` : ''}.`,
    today: 'hoy',
    tomorrow: 'mañana',
    forecast: ({ name, house, sky }) => `Tiempo ${name} en ${house}: ${sky}`,
    high: (value) => `máxima ${value}`,
    low: (value) => `mínima ${value}`,
    rain: (value) => `${value} % de probabilidad de lluvia`,
    current: ({ house, temperature, sky }) => `En ${house}: ${temperature}, ${sky}`,
    humidity: (value) => `humedad ${value} %`,
    wind: (value) => `viento ${value}`,
    observed: (time) => ` (observado a las ${time}).`,
    forecasted: ' (previsión).',
  },
};

const sentences = (language) => SENTENCES[language] ?? SENTENCES.en;

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
 * @param {string} options.language - 'en', 'fr', 'de' or 'es'.
 * @returns {object} The outputs.
 * @example
 * buildAlertsOutputs({ alerts, house: 'Home', timeZone: 'America/Chicago', language: 'en' });
 */
function buildAlertsOutputs({ alerts, house, timeZone, language }) {
  const counts = countByLevel(alerts);
  const top = alerts[0] ?? null;
  const events = [...new Set(alerts.map((alert) => alert.event))].join(', ');
  const say = sentences(language);
  const summary =
    top === null
      ? say.noAlert({ house })
      : say.alerts({
          count: alerts.length,
          house,
          events,
          top: top.event,
          until: top.end ? formatDayTime(top.end, timeZone, language) : null,
        });
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
 * @param {string} options.language - 'en', 'fr', 'de' or 'es'.
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
  const say = sentences(language);
  const name = offset === 0 ? say.today : offset === 1 ? say.tomorrow : weekdayName(date, language);

  const sky = inSentence(conditionLabel(condition, language), language);
  const parts = [say.forecast({ name, house, sky })];
  if (temperatureMax !== null) {
    parts.push(say.high(`${Math.round(temperatureMax)}${labels.temperature}`));
  }
  if (temperatureMin !== null) {
    parts.push(say.low(`${Math.round(temperatureMin)}${labels.temperature}`));
  }
  if (precipitationProbability) {
    parts.push(say.rain(precipitationProbability));
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
 * @param {string} options.language - 'en', 'fr', 'de' or 'es'.
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
  const sky = inSentence(conditionLabel(weather.weather, language), language);
  const observedAt = observation?.timestamp
    ? formatTime(observation.timestamp, timeZone, language)
    : null;

  const say = sentences(language);
  let summary = say.current({ house, temperature: `${temperature}${labels.temperature}`, sky });
  if (weather.humidity !== undefined) {
    summary += `, ${say.humidity(weather.humidity)}`;
  }
  if (windSpeed !== null) {
    summary += `, ${say.wind(`${windSpeed} ${labels.speed}`)}`;
  }
  summary += observedAt ? say.observed(observedAt) : say.forecasted;

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
  SENTENCES,
  MAX_DAY_OFFSET,
  readDayOffset,
  buildAlertsOutputs,
  buildForecastOutputs,
  buildCurrentOutputs,
};
