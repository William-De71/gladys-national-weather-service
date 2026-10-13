// -----------------------------------------------------------------------------
// Dashboard widgets of the National Weather Service integration.
//
// The core weather widget already shows the forecast this integration
// provides (current conditions, hours, days, alert badges). The widgets add
// what only the NWS has, or what that generic card cannot show:
//
//   - `alerts`   the watches, warnings and advisories in force: counters by
//                level, then each alert with its full text and instructions
//                in the detail panel. Nudged by the alert watcher, so a new
//                Tornado Warning reaches a wall tablet within seconds;
//   - `forecast` the NWS narrative forecast, period by period ("Tonight",
//                "Saturday"…), with the NWS icons and the forecaster's text;
//   - `hourly`   the next 12 to 48 hours as a curve: temperature and feels
//                like, chance of rain, or wind and gusts, with the extremes
//                annotated.
//
// The content is built per user language and unit system (the core caches it
// per variant). The NWS writes in English only: its own texts (event names,
// narratives, alert bodies) stay in English, everything around them follows
// the language of the user.
//
// Icons: the NWS serves PNG icons per period. Their URL is turned into an
// image key that encodes it entirely ("nws-day-tsraqhi-40"), so the image
// handler can rebuild the URL from the key alone — after a restart too —
// and can only ever fetch an NWS icon, never an arbitrary URL.
// -----------------------------------------------------------------------------

import { conditionLabel, parseIcon, readCondition, ICON_CONDITIONS } from './conditions.js';
import { CATEGORY_LABELS, LEVEL_LABELS, countByLevel, localize } from './alerts.js';
import { buildHour, upcomingPeriods } from './weather.js';
import { readGrid } from './gridpoint.js';
import { formatDayTime, formatTime, localDate, periodDate, weekdayName } from './time.js';
import { displaySpeed, degreesToCompass, unitLabels } from './units.js';
import { formatPercent } from './i18n.js';

const WIDGETS = {
  ALERTS: 'alerts',
  FORECAST: 'forecast',
  HOURLY: 'hourly',
};

const TTL_SECONDS = {
  [WIDGETS.ALERTS]: 120,
  [WIDGETS.FORECAST]: 900,
  [WIDGETS.HOURLY]: 900,
};

const HOURLY_METRICS = ['temperature', 'precipitation', 'wind'];
const HOURLY_SPANS = ['12', '24', '48'];
const MAX_LIST_ITEMS = 8;
const MAX_DESCRIPTION = 2000;
// A chance of rain from which an hour counts as "rain expected".
const RAIN_CHANCE_THRESHOLD = 30;

const TEXTS = {
  noAlertTitle: {
    en: 'No active alert',
    fr: 'Aucune alerte',
    de: 'Keine aktive Warnung',
    es: 'Ninguna alerta activa',
  },
  noAlertBody: {
    en: 'No watch, warning or advisory is in force for this location.',
    fr: 'Aucune veille, alerte ni avis n’est en cours pour ce lieu.',
    de: 'Für diesen Ort gilt keine Vorwarnung, Warnung und kein Hinweis.',
    es: 'No hay ninguna vigilancia, aviso ni advertencia en vigor para este lugar.',
  },
  active: {
    en: 'Active alerts',
    fr: 'Alertes en cours',
    de: 'Aktive Warnungen',
    es: 'Alertas activas',
  },
  warnings: { en: 'Warnings', fr: 'Alertes', de: 'Warnungen', es: 'Avisos' },
  watches: { en: 'Watches', fr: 'Veilles', de: 'Vorwarnungen', es: 'Vigilancias' },
  advisories: { en: 'Advisories', fr: 'Avis', de: 'Hinweise', es: 'Advertencias' },
  from: { en: 'from', fr: 'dès', de: 'ab', es: 'desde' },
  until: { en: 'until', fr: 'jusqu’à', de: 'bis', es: 'hasta' },
  fullForecast: {
    en: 'Full forecast',
    fr: 'Prévisions complètes',
    de: 'Vollständige Vorhersage',
    es: 'Previsión completa',
  },
  outOfCoverage: {
    en: 'This house is outside the National Weather Service coverage (United States only).',
    fr: 'Cette maison est hors de la zone du National Weather Service (États-Unis uniquement).',
    de: 'Dieses Zuhause liegt außerhalb des Gebiets des National Weather Service (nur Vereinigte Staaten).',
    es: 'Esta casa está fuera de la cobertura del National Weather Service (solo Estados Unidos).',
  },
  noForecast: {
    en: 'The National Weather Service has no hourly forecast to come for this house right now.',
    fr: 'Le National Weather Service ne fournit pas de prévision horaire à venir pour cette maison en ce moment.',
    de: 'Der National Weather Service hat für dieses Zuhause gerade keine kommende stündliche Vorhersage.',
    es: 'El National Weather Service no tiene ahora mismo previsión por horas para esta casa.',
  },
  noHouse: {
    en: 'No house of Gladys has a location: set it in the house settings.',
    fr: 'Aucune maison de Gladys n’est localisée : renseignez sa position dans ses réglages.',
    de: 'Kein Zuhause in Gladys hat einen Standort: Lege ihn in den Einstellungen des Zuhauses fest.',
    es: 'Ninguna casa de Gladys tiene ubicación: defínala en los ajustes de la casa.',
  },
  updated: { en: 'updated', fr: 'mis à jour à', de: 'aktualisiert um', es: 'actualizado a las' },
  high: { en: 'High', fr: 'Max', de: 'Max.', es: 'Máx.' },
  low: { en: 'Low', fr: 'Min', de: 'Min.', es: 'Mín.' },
  now: { en: 'Now', fr: 'Actuel', de: 'Jetzt', es: 'Ahora' },
  temperature: { en: 'Temperature', fr: 'Température', de: 'Temperatur', es: 'Temperatura' },
  feelsLike: { en: 'Feels like', fr: 'Ressenti', de: 'Gefühlt', es: 'Sensación' },
  rainChance: {
    en: 'Chance of rain',
    fr: 'Risque de pluie',
    de: 'Regenrisiko',
    es: 'Prob. de lluvia',
  },
  maxChance: { en: 'Max chance', fr: 'Risque max', de: 'Max. Risiko', es: 'Prob. máx.' },
  total: { en: 'Total', fr: 'Cumul', de: 'Summe', es: 'Total' },
  firstRain: { en: 'First rain', fr: '1re pluie', de: 'Erster Regen', es: '1.ª lluvia' },
  none: { en: 'None', fr: 'Aucune', de: 'Keiner', es: 'Ninguna' },
  wind: { en: 'Wind', fr: 'Vent', de: 'Wind', es: 'Viento' },
  gusts: { en: 'Gusts', fr: 'Rafales', de: 'Böen', es: 'Rachas' },
  maxWind: { en: 'Max wind', fr: 'Vent max', de: 'Max. Wind', es: 'Viento máx.' },
  maxGust: { en: 'Max gust', fr: 'Rafale max', de: 'Max. Böe', es: 'Racha máx.' },
  direction: { en: 'Direction', fr: 'Direction', de: 'Richtung', es: 'Dirección' },
  nextHours: {
    en: 'Next {n} hours',
    fr: '{n} prochaines heures',
    de: 'Nächste {n} Stunden',
    es: 'Próximas {n} horas',
  },
  today: { en: 'Today', fr: 'Aujourd’hui', de: 'Heute', es: 'Hoy' },
  tonight: { en: 'Tonight', fr: 'Cette nuit', de: 'Heute Nacht', es: 'Esta noche' },
  overnight: { en: 'Overnight', fr: 'Fin de nuit', de: 'Bis zum Morgen', es: 'Madrugada' },
  // German glues the weekday to the night ("Samstagnacht").
  nightOf: { en: '{day} Night', fr: 'Nuit de {day}', de: '{day}nacht', es: 'Noche del {day}' },
};

/**
 * @description Pick a text in the user's language (English fallback).
 * @param {string} key - The TEXTS key.
 * @param {string} language - The language.
 * @param {object} [values] - `{name}` substitutions.
 * @returns {string} The text.
 * @example
 * text('nextHours', 'fr', { n: 24 }); // -> '24 prochaines heures'
 */
function text(key, language, values = {}) {
  const entry = TEXTS[key];
  const template = entry[language] ?? entry.en;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
}

const capitalize = (value) => value.charAt(0).toUpperCase() + value.slice(1);

/**
 * @description Truncate a text to a bound, with an ellipsis.
 * @param {string} value - The text.
 * @param {number} max - The bound in characters.
 * @returns {string} The text.
 * @example
 * truncate('abcdef', 4); // -> 'abc…'
 */
function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * @description The weather.gov forecast page of a location.
 * @param {number} latitude - Latitude.
 * @param {number} longitude - Longitude.
 * @returns {string} The https URL.
 * @example
 * forecastPageUrl(39.7456, -97.0892);
 */
function forecastPageUrl(latitude, longitude) {
  return `https://forecast.weather.gov/MapClick.php?lat=${latitude.toFixed(4)}&lon=${longitude.toFixed(4)}`;
}

// --- Icons --------------------------------------------------------------------

const ICON_KEY_PREFIX = 'nws';
const MAX_ICON_PARTS = 2;

/**
 * @description Turn an NWS icon URL into an image key encoding it whole:
 * underscores become "q" (no NWS code contains a "q"), parts and chances are
 * dash-separated.
 * @param {string|null} url - The icon URL.
 * @returns {string|null} The key, or null for an unknown icon.
 * @example
 * iconKey('https://api.weather.gov/icons/land/day/tsra_hi,40?size=medium'); // -> 'nws-day-tsraqhi-40'
 */
function iconKey(url) {
  const icon = parseIcon(url);
  if (icon === null || icon.parts.length > MAX_ICON_PARTS) {
    return null;
  }
  if (!icon.parts.every((part) => part.code in ICON_CONDITIONS)) {
    return null;
  }
  const tokens = icon.parts.flatMap((part) => [
    part.code.replaceAll('_', 'q'),
    ...(part.chance === null ? [] : [String(Math.round(part.chance))]),
  ]);
  return [ICON_KEY_PREFIX, icon.isDay ? 'day' : 'night', ...tokens].join('-');
}

/**
 * @description Rebuild the icon path of an image key, validating every piece:
 * only known NWS codes and chances from 0 to 100 come out of it.
 * @param {string} key - The image key.
 * @returns {string|null} The path after /icons/ ("land/day/tsra_hi,40"), or null.
 * @example
 * iconPathFromKey('nws-night-rainqshowers-30-tsra-60'); // -> 'land/night/rain_showers,30/tsra,60'
 */
function iconPathFromKey(key) {
  const [prefix, timeOfDay, ...tokens] = String(key).split('-');
  if (prefix !== ICON_KEY_PREFIX || (timeOfDay !== 'day' && timeOfDay !== 'night')) {
    return null;
  }
  const parts = [];
  for (const token of tokens) {
    if (/^\d{1,3}$/.test(token)) {
      const last = parts[parts.length - 1];
      if (last === undefined || last.chance !== null || Number(token) > 100) {
        return null;
      }
      last.chance = Number(token);
    } else {
      const code = token.replaceAll('q', '_');
      if (!/^[a-z_]+$/.test(code) || !(code in ICON_CONDITIONS)) {
        return null;
      }
      parts.push({ code, chance: null });
    }
  }
  if (parts.length === 0 || parts.length > MAX_ICON_PARTS) {
    return null;
  }
  const segments = parts.map(({ code, chance }) => (chance === null ? code : `${code},${chance}`));
  return ['land', timeOfDay, ...segments].join('/');
}

// --- Empty and error states ---------------------------------------------------

/**
 * @description A content made of a single explanatory text.
 * @param {string} message - The text.
 * @param {number} ttl - The TTL in seconds.
 * @returns {object} The content.
 * @example
 * messageContent('No house', 300);
 */
function messageContent(message, ttl) {
  return {
    version: 1,
    ttl_seconds: ttl,
    components: [{ type: 'text', variant: 'body', text: message }],
  };
}

// --- Alerts widget ------------------------------------------------------------

const SEVERITY_COLORS = {
  extreme: 'danger',
  severe: 'danger',
  moderate: 'warning',
  minor: 'info',
  unknown: 'info',
};

/**
 * @description Build the content of the `alerts` widget.
 * @param {object} options - Options.
 * @param {Array<object>} options.alerts - The readAlerts() alerts.
 * @param {object} options.house - The house ({ name, latitude, longitude }).
 * @param {string|null} options.place - "Linn, KS".
 * @param {string|null} options.timeZone - The time zone of the house.
 * @param {string} options.language - The user language.
 * @param {number} [options.now] - Current time in ms.
 * @returns {object} The widget content.
 * @example
 * buildAlertsWidget({ alerts, house, place: 'Linn, KS', timeZone, language: 'en' });
 */
function buildAlertsWidget({ alerts, house, place, timeZone, language, now = Date.now() }) {
  const components = [
    { type: 'text', variant: 'caption', text: place ? `${house.name} · ${place}` : house.name },
  ];
  if (alerts.length === 0) {
    components.push(
      {
        type: 'value',
        value: 0,
        label: text('active', language),
        icon: 'check-circle',
        color: 'success',
      },
      { type: 'text', variant: 'body', text: text('noAlertBody', language) },
    );
  } else {
    const counts = countByLevel(alerts);
    components.push(
      {
        type: 'value',
        value: counts.warning,
        label: text('warnings', language),
        icon: 'alert-octagon',
        color: counts.warning > 0 ? 'danger' : 'neutral',
      },
      {
        type: 'value',
        value: counts.watch,
        label: text('watches', language),
        icon: 'alert-triangle',
        color: counts.watch > 0 ? 'warning' : 'neutral',
      },
      {
        type: 'value',
        value: counts.advisory + counts.statement + counts.other,
        label: text('advisories', language),
        icon: 'info',
        color: 'info',
      },
      {
        type: 'card-list',
        display: 'list',
        items: alerts.slice(0, MAX_LIST_ITEMS).map((alert) => {
          const until = alert.end ? formatDayTime(alert.end, timeZone, language) : null;
          // A watch often starts later: its start is worth the room then.
          const from =
            alert.start && Date.parse(alert.start) > now
              ? formatDayTime(alert.start, timeZone, language)
              : null;
          const subtitle = [
            localize(CATEGORY_LABELS, alert.category, language),
            from ? `${text('from', language)} ${from}` : null,
            until ? `${text('until', language)} ${until}` : null,
          ]
            .filter(Boolean)
            .join(' · ');
          const body = [alert.headline, alert.description, alert.instruction, alert.area]
            .filter(Boolean)
            .join('\n\n');
          const item = {
            title: truncate(alert.event, 60),
            subtitle: truncate(subtitle, 60),
            badge: {
              text: localize(LEVEL_LABELS, alert.level, language),
              color: SEVERITY_COLORS[alert.severity],
            },
            links: [
              { url: forecastPageUrl(house.latitude, house.longitude), label: 'weather.gov' },
            ],
          };
          if (body) {
            item.description = truncate(body, MAX_DESCRIPTION);
          }
          return item;
        }),
      },
    );
  }
  components.push({
    type: 'button',
    label: text('fullForecast', language),
    icon: 'external-link',
    link: { url: forecastPageUrl(house.latitude, house.longitude) },
  });
  return { version: 1, ttl_seconds: TTL_SECONDS[WIDGETS.ALERTS], components };
}

// --- Forecast widget ----------------------------------------------------------

/**
 * @description The title of a forecast period in the user's language: the NWS
 * name in English ("Saturday Night"), rebuilt from the date in the other
 * languages. After midnight the NWS lists the end of the night ("Overnight",
 * starting in the small hours) then the coming night ("Tonight"), both dated
 * today: the first one is told apart by its local start hour (the period time
 * carries its offset).
 * @param {object} period - The /forecast period.
 * @param {string} today - The local date of today, YYYY-MM-DD.
 * @param {string} language - The user language.
 * @returns {string} The title.
 * @example
 * periodTitle(period, '2026-10-09', 'fr'); // -> 'Nuit de samedi'
 */
function periodTitle(period, today, language) {
  if (language === 'en' && period.name) {
    return period.name;
  }
  const date = periodDate(period.startTime);
  if (date === today) {
    if (period.isDaytime) {
      return text('today', language);
    }
    const hour = Number(String(period.startTime).slice(11, 13));
    return text(hour < 12 ? 'overnight' : 'tonight', language);
  }
  const day = weekdayName(date, language);
  return period.isDaytime ? capitalize(day) : text('nightOf', language, { day });
}

/**
 * @description Build the content of the `forecast` widget.
 * @param {object} options - Options.
 * @param {object} options.forecast - The /forecast payload, in the user's units.
 * @param {object} options.house - The house.
 * @param {string|null} options.place - "Linn, KS".
 * @param {string|null} options.timeZone - The time zone of the house.
 * @param {string} options.language - The user language.
 * @param {string} options.units - 'metric' or 'us'.
 * @param {boolean} options.showIcons - Whether to show the NWS icons.
 * @param {number} [options.now] - Current time in ms.
 * @returns {object} The widget content.
 * @example
 * buildForecastWidget({ forecast, house, place, timeZone, language: 'en', units: 'us', showIcons: true });
 */
function buildForecastWidget({
  forecast,
  house,
  place,
  timeZone,
  language,
  units,
  showIcons,
  now = Date.now(),
}) {
  const periods = upcomingPeriods(forecast, now).slice(0, MAX_LIST_ITEMS);
  const today = localDate(now, timeZone);
  const labels = unitLabels(units);
  const updated = forecast?.properties?.updateTime;
  const caption = [
    house.name,
    place,
    updated ? `${text('updated', language)} ${formatTime(updated, timeZone, language)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const items = periods.map((period) => {
    const temperature = `${text(period.isDaytime ? 'high' : 'low', language)} ${Math.round(period.temperature)}${labels.temperature}`;
    const sky =
      language === 'en' && period.shortForecast
        ? period.shortForecast
        : conditionLabel(readCondition(period.icon, period.shortForecast), language);
    const item = {
      title: periodTitle(period, today, language),
      // The temperature first: the front shows the subtitle on one line, and
      // a long NWS short forecast ("Sunny then Slight Chance Showers And
      // Thunderstorms") would push it out of sight.
      subtitle: truncate(`${temperature} · ${sky}`, 60),
    };
    const chance = period.probabilityOfPrecipitation?.value;
    if (typeof chance === 'number' && chance >= 20) {
      const rounded = Math.round(chance);
      item.badge = { text: formatPercent(rounded, language), color: 'info' };
    }
    if (period.detailedForecast) {
      item.description = truncate(period.detailedForecast, MAX_DESCRIPTION);
    }
    if (showIcons) {
      const key = iconKey(period.icon);
      if (key !== null) {
        item.image = key;
      }
    }
    return item;
  });

  const components = [{ type: 'text', variant: 'caption', text: truncate(caption, 80) }];
  if (items.length > 0) {
    components.push({ type: 'card-list', display: 'list', items });
  }
  components.push({
    type: 'button',
    label: text('fullForecast', language),
    icon: 'external-link',
    link: { url: forecastPageUrl(house.latitude, house.longitude) },
  });
  return { version: 1, ttl_seconds: TTL_SECONDS[WIDGETS.FORECAST], components };
}

// --- Hourly widget ------------------------------------------------------------

/**
 * @description Read the hourly settings.
 * @param {object} settings - The widget settings.
 * @returns {{ metric: string, hours: number }} The metric and span.
 * @example
 * readHourlySettings({ metric: 'wind', hours: '48' }); // -> { metric: 'wind', hours: 48 }
 */
function readHourlySettings(settings = {}) {
  const metric = HOURLY_METRICS.includes(settings.metric) ? settings.metric : 'temperature';
  const hours = HOURLY_SPANS.includes(String(settings.hours)) ? Number(settings.hours) : 24;
  return { metric, hours };
}

/**
 * @description The entry with the highest (or lowest) value of a field.
 * @param {Array<object>} entries - Entries.
 * @param {string} field - The field.
 * @param {number} sign - 1 for the maximum, -1 for the minimum.
 * @returns {object|null} The entry.
 * @example
 * extreme(hours, 'temperature', 1);
 */
function extreme(entries, field, sign) {
  return entries.reduce((best, entry) => {
    if (typeof entry[field] !== 'number') {
      return best;
    }
    return best === null || sign * entry[field] > sign * best[field] ? entry : best;
  }, null);
}

const iso = (value) => new Date(value).toISOString();

/**
 * @description Build the content of the `hourly` widget.
 * @param {object} options - Options.
 * @param {object} options.hourly - The /forecast/hourly payload.
 * @param {object|null} options.grid - The /gridpoints payload.
 * @param {object} options.house - The house.
 * @param {string|null} options.place - "Linn, KS".
 * @param {string|null} options.timeZone - The time zone of the house.
 * @param {string} options.language - The user language.
 * @param {string} options.units - 'metric' or 'us'.
 * @param {object} options.settings - The widget settings.
 * @param {number} [options.now] - Current time in ms.
 * @returns {object} The widget content.
 * @example
 * buildHourlyWidget({ hourly, grid, house, place, timeZone, language: 'en', units: 'us', settings: {} });
 */
function buildHourlyWidget({
  hourly,
  grid,
  house,
  place,
  timeZone,
  language,
  units,
  settings,
  now = Date.now(),
}) {
  const { metric, hours: span } = readHourlySettings(settings);
  const layers = readGrid(grid);
  const hours = upcomingPeriods(hourly, now)
    .slice(0, span)
    .map((period) => buildHour(period, layers, units));
  const ttl = TTL_SECONDS[WIDGETS.HOURLY];
  // No hour to come: a stale or empty forecast (outside the coverage is
  // handled before, by the point lookup).
  if (hours.length === 0) {
    return messageContent(text('noForecast', language), ttl);
  }
  const labels = unitLabels(units);
  const caption = {
    type: 'text',
    variant: 'caption',
    text: truncate([house.name, place].filter(Boolean).join(' · '), 80),
  };
  const title = text('nextHours', language, { n: hours.length });
  const time = (entry) => formatTime(entry.datetime, timeZone, language);
  const components = [caption];

  if (metric === 'temperature') {
    // Hours without a temperature are left out of the curve and the values.
    const temperatures = hours.filter((h) => typeof h.temperature === 'number');
    if (temperatures.length === 0) {
      return messageContent(text('noForecast', language), ttl);
    }
    const max = extreme(temperatures, 'temperature', 1);
    const min = extreme(temperatures, 'temperature', -1);
    const series = [
      {
        name: text('temperature', language),
        points: temperatures.map((h) => ({ t: iso(h.datetime), v: h.temperature })),
      },
    ];
    const feels = temperatures.filter((h) => typeof h.apparent_temperature === 'number');
    if (
      feels.length === temperatures.length &&
      feels.some((h) => Math.abs(h.apparent_temperature - h.temperature) >= 1)
    ) {
      series.push({
        name: text('feelsLike', language),
        points: feels.map((h) => ({ t: iso(h.datetime), v: h.apparent_temperature })),
      });
    }
    components.push(
      {
        type: 'value',
        value: Math.round(temperatures[0].temperature),
        unit: labels.temperature,
        label: text('now', language),
        icon: 'thermometer',
      },
      {
        type: 'value',
        value: Math.round(max.temperature),
        unit: labels.temperature,
        label: `${text('high', language)} ${time(max)}`,
        color: 'danger',
      },
      {
        type: 'value',
        value: Math.round(min.temperature),
        unit: labels.temperature,
        label: `${text('low', language)} ${time(min)}`,
        color: 'info',
      },
      {
        type: 'chart',
        chart_type: 'line',
        title,
        unit: labels.temperature,
        series,
        now_marker: true,
        annotations: [
          {
            t: iso(max.datetime),
            value: max.temperature,
            label: `${Math.round(max.temperature)}°`,
            color: 'danger',
          },
          {
            t: iso(min.datetime),
            value: min.temperature,
            label: `${Math.round(min.temperature)}°`,
            color: 'info',
          },
        ],
      },
    );
  } else if (metric === 'precipitation') {
    const chances = hours.map((h) => h.precipitation_probability ?? 0);
    const maxChance = Math.max(...chances);
    const first =
      hours.find((h) => (h.precipitation_probability ?? 0) >= RAIN_CHANCE_THRESHOLD) ?? null;
    const amounts = hours.map((h) => h.precipitation).filter((value) => typeof value === 'number');
    const total = amounts.reduce((sum, value) => sum + value, 0);
    components.push(
      {
        type: 'value',
        value: maxChance,
        unit: '%',
        label: text('maxChance', language),
        icon: 'umbrella',
        color: maxChance >= 60 ? 'primary' : 'neutral',
      },
      {
        type: 'value',
        value: first ? time(first) : text('none', language),
        label: text('firstRain', language),
        icon: 'clock',
      },
    );
    if (amounts.length > 0) {
      components.push({
        type: 'value',
        value: units === 'us' ? Math.round(total * 100) / 100 : Math.round(total * 10) / 10,
        unit: labels.precipitation,
        label: text('total', language),
        icon: 'droplet',
      });
    }
    const chart = {
      type: 'chart',
      chart_type: 'bar',
      title: `${text('rainChance', language)} · ${title}`,
      unit: '%',
      series: [
        {
          name: text('rainChance', language),
          points: hours.map((h, index) => ({ t: iso(h.datetime), v: chances[index] })),
        },
      ],
      now_marker: true,
    };
    if (first) {
      chart.annotations = [{ t: iso(first.datetime), label: time(first), color: 'primary' }];
    }
    components.push(chart);
  } else {
    const speeds = hours.map((h) => displaySpeed(h.wind_speed, units) ?? 0);
    const gusts = hours.map((h) => displaySpeed(h.wind_gust, units));
    const hasGusts = gusts.every((value) => typeof value === 'number');
    const maxSpeed = Math.max(...speeds);
    const maxGustValue = hasGusts ? Math.max(...gusts) : null;
    const gustIndex = hasGusts ? gusts.indexOf(maxGustValue) : -1;
    components.push({
      type: 'value',
      value: maxSpeed,
      unit: labels.speed,
      label: text('maxWind', language),
      icon: 'wind',
    });
    if (hasGusts) {
      components.push({
        type: 'value',
        value: maxGustValue,
        unit: labels.speed,
        label: `${text('maxGust', language)} ${time(hours[gustIndex])}`,
        color: maxGustValue >= (units === 'us' ? 40 : 60) ? 'warning' : 'neutral',
      });
    }
    const direction = degreesToCompass(hours[0].wind_direction);
    if (direction) {
      components.push({
        type: 'value',
        value: direction,
        label: text('direction', language),
        icon: 'navigation',
      });
    }
    const series = [
      {
        name: text('wind', language),
        points: hours.map((h, index) => ({ t: iso(h.datetime), v: speeds[index] })),
      },
    ];
    if (hasGusts) {
      series.push({
        name: text('gusts', language),
        points: hours.map((h, index) => ({ t: iso(h.datetime), v: gusts[index] })),
      });
    }
    const chart = {
      type: 'chart',
      chart_type: 'line',
      title,
      unit: labels.speed,
      series,
      now_marker: true,
    };
    if (hasGusts) {
      chart.annotations = [
        {
          t: iso(hours[gustIndex].datetime),
          value: maxGustValue,
          label: `${maxGustValue}`,
          color: 'warning',
        },
      ];
    }
    components.push(chart);
  }
  return { version: 1, ttl_seconds: ttl, components };
}

export {
  WIDGETS,
  TEXTS,
  TTL_SECONDS,
  HOURLY_METRICS,
  HOURLY_SPANS,
  text,
  truncate,
  forecastPageUrl,
  iconKey,
  iconPathFromKey,
  messageContent,
  buildAlertsWidget,
  periodTitle,
  buildForecastWidget,
  readHourlySettings,
  buildHourlyWidget,
};
