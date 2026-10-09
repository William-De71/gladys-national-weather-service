// -----------------------------------------------------------------------------
// NWS sky conditions -> the pivot condition enum of Gladys (contract B.18).
//
// Every NWS period carries an icon URL that encodes its weather in a small,
// stable code list, plus the time of day:
//
//   https://api.weather.gov/icons/land/day/tsra_hi,40?size=medium
//   https://api.weather.gov/icons/land/night/rain_showers,30/tsra,60
//                                     |     |               |
//                                  day/night  code,chance  then code,chance
//
// A two-part icon is a transition ("showers, then thunderstorms"): the period
// is summed up by its most significant phenomenon, a thunderstorm beating a
// shower. The observations sometimes come without an icon (an automated
// station reporting nothing but figures): the text description is read then.
// -----------------------------------------------------------------------------

// NWS icon code -> pivot condition.
const ICON_CONDITIONS = {
  skc: 'clear',
  few: 'clear',
  sct: 'partly-cloudy',
  bkn: 'cloud',
  ovc: 'cloud',
  wind_skc: 'wind',
  wind_few: 'wind',
  wind_sct: 'wind',
  wind_bkn: 'wind',
  wind_ovc: 'wind',
  snow: 'snow',
  blizzard: 'snow',
  rain_snow: 'sleet',
  rain_sleet: 'sleet',
  snow_sleet: 'sleet',
  sleet: 'sleet',
  fzra: 'freezing-rain',
  rain_fzra: 'freezing-rain',
  snow_fzra: 'freezing-rain',
  rain: 'rain',
  rain_showers: 'rain',
  rain_showers_hi: 'rain',
  tsra: 'thunderstorm',
  tsra_sct: 'thunderstorm',
  tsra_hi: 'thunderstorm',
  tornado: 'tornado',
  hurricane: 'hurricane',
  tropical_storm: 'hurricane',
  dust: 'sandstorm',
  smoke: 'fog',
  haze: 'fog',
  fog: 'fog',
  hot: 'clear',
  cold: 'clear',
};

// Significance of each condition, to sum up a transition or a whole day by
// its most marking phenomenon. Higher wins.
const CONDITION_RANK = {
  unknown: 0,
  night: 0,
  clear: 1,
  'partly-cloudy': 2,
  cloud: 3,
  wind: 4,
  fog: 5,
  'freezing-fog': 6,
  sandstorm: 6,
  drizzle: 7,
  rain: 8,
  pouring: 9,
  sleet: 10,
  snow: 11,
  hail: 12,
  'freezing-rain': 13,
  thunderstorm: 14,
  'snow-thunderstorm': 15,
  hurricane: 16,
  tornado: 17,
};

// Text fallback, in priority order: the first pattern that matches wins.
const TEXT_PATTERNS = [
  [/tornado|funnel cloud|waterspout/, 'tornado'],
  [/hurricane|tropical storm/, 'hurricane'],
  [/(thunder|t-storm|tstm).*snow|snow.*(thunder|t-storm|tstm)/, 'snow-thunderstorm'],
  [/thunder|t-storm|tstm/, 'thunderstorm'],
  [/freezing (rain|drizzle)/, 'freezing-rain'],
  [/freezing fog/, 'freezing-fog'],
  [/hail/, 'hail'],
  [/sleet|ice pellets|wintry mix|rain and snow|snow and rain/, 'sleet'],
  [/snow|flurr|blizzard/, 'snow'],
  [/heavy rain/, 'pouring'],
  [/drizzle/, 'drizzle'],
  [/rain|showers/, 'rain'],
  [/fog|mist|haze|smoke/, 'fog'],
  [/dust|sand/, 'sandstorm'],
  [/windy|breezy|blustery|wind/, 'wind'],
  [/partly (cloudy|sunny)/, 'partly-cloudy'],
  [/mostly (sunny|clear)/, 'clear'],
  [/overcast|cloudy|clouds/, 'cloud'],
  [/sunny|clear|fair/, 'clear'],
];

/**
 * @description Parse an NWS icon URL.
 * @param {string|null} url - The icon URL.
 * @returns {{ isDay: boolean, parts: Array<{ code: string, chance: number|null }> }|null}
 * The time of day and the coded parts, or null when the URL is not an icon.
 * @example
 * parseIcon('https://api.weather.gov/icons/land/day/tsra_hi,40?size=medium');
 * // -> { isDay: true, parts: [{ code: 'tsra_hi', chance: 40 }] }
 */
function parseIcon(url) {
  if (typeof url !== 'string' || url === '') {
    return null;
  }
  let path;
  try {
    path = new URL(url, 'https://api.weather.gov').pathname;
  } catch {
    return null;
  }
  const segments = path.split('/').filter(Boolean);
  const start = segments.indexOf('icons');
  if (start === -1 || segments.length < start + 4) {
    return null;
  }
  const timeOfDay = segments[start + 2];
  if (timeOfDay !== 'day' && timeOfDay !== 'night') {
    return null;
  }
  const parts = segments.slice(start + 3).map((segment) => {
    const [code, chance] = decodeURIComponent(segment).split(',');
    const value = Number(chance);
    return { code, chance: chance !== undefined && Number.isFinite(value) ? value : null };
  });
  return { isDay: timeOfDay === 'day', parts };
}

/**
 * @description The most significant of several conditions.
 * @param {Array<string>} conditions - Pivot conditions.
 * @returns {string} The one with the highest rank ('unknown' when empty).
 * @example
 * mostSignificant(['rain', 'thunderstorm']); // -> 'thunderstorm'
 */
function mostSignificant(conditions) {
  return conditions.reduce(
    (best, condition) =>
      (CONDITION_RANK[condition] ?? 0) > (CONDITION_RANK[best] ?? 0) ? condition : best,
    'unknown',
  );
}

/**
 * @description Read the pivot condition of an NWS icon URL.
 * @param {string|null} url - The icon URL.
 * @returns {string|null} The condition, or null when the icon is unreadable.
 * @example
 * conditionFromIcon('https://api.weather.gov/icons/land/night/rain_showers,30/tsra,60');
 * // -> 'thunderstorm'
 */
function conditionFromIcon(url) {
  const icon = parseIcon(url);
  if (icon === null) {
    return null;
  }
  const known = icon.parts.map((part) => ICON_CONDITIONS[part.code]).filter(Boolean);
  return known.length === 0 ? null : mostSignificant(known);
}

/**
 * @description Read the pivot condition of an NWS text ("Chance Showers And
 * Thunderstorms", "Mostly Sunny").
 * @param {string|null} text - The short forecast or text description.
 * @returns {string} The condition ('unknown' when nothing matches).
 * @example
 * conditionFromText('Slight Chance Light Rain'); // -> 'rain'
 */
function conditionFromText(text) {
  const normalized = String(text ?? '').toLowerCase();
  if (normalized.trim() === '') {
    return 'unknown';
  }
  const match = TEXT_PATTERNS.find(([pattern]) => pattern.test(normalized));
  return match === undefined ? 'unknown' : match[1];
}

/**
 * @description The pivot condition of an NWS period or observation: the icon
 * first, the text when the icon is missing or unknown.
 * @param {string|null} iconUrl - The icon URL.
 * @param {string|null} text - The short forecast or text description.
 * @returns {string} The condition.
 * @example
 * readCondition(null, 'Partly Cloudy'); // -> 'partly-cloudy'
 */
function readCondition(iconUrl, text) {
  return conditionFromIcon(iconUrl) ?? conditionFromText(text);
}

/**
 * @description Whether an icon URL is a daytime one.
 * @param {string|null} url - The icon URL.
 * @returns {boolean|undefined} True by day, false by night, undefined when unknown.
 * @example
 * isDayFromIcon('https://api.weather.gov/icons/land/night/skc'); // -> false
 */
function isDayFromIcon(url) {
  const icon = parseIcon(url);
  return icon === null ? undefined : icon.isDay;
}

// Localized labels of the pivot conditions, for the scene outputs and widgets.
const CONDITION_LABELS = {
  clear: { en: 'Clear', fr: 'Ciel dégagé' },
  'partly-cloudy': { en: 'Partly cloudy', fr: 'Éclaircies' },
  cloud: { en: 'Cloudy', fr: 'Nuageux' },
  fog: { en: 'Fog', fr: 'Brouillard' },
  drizzle: { en: 'Drizzle', fr: 'Bruine' },
  rain: { en: 'Rain', fr: 'Pluie' },
  pouring: { en: 'Heavy rain', fr: 'Pluie forte' },
  sleet: { en: 'Rain and snow', fr: 'Pluie et neige' },
  hail: { en: 'Hail', fr: 'Grêle' },
  snow: { en: 'Snow', fr: 'Neige' },
  thunderstorm: { en: 'Thunderstorms', fr: 'Orages' },
  wind: { en: 'Windy', fr: 'Venteux' },
  night: { en: 'Night', fr: 'Nuit' },
  unknown: { en: 'Unknown', fr: 'Inconnu' },
  'freezing-rain': { en: 'Freezing rain', fr: 'Pluie verglaçante' },
  'freezing-fog': { en: 'Freezing fog', fr: 'Brouillard givrant' },
  'snow-thunderstorm': { en: 'Thundersnow', fr: 'Orage de neige' },
  sandstorm: { en: 'Dust storm', fr: 'Tempête de poussière' },
  tornado: { en: 'Tornado', fr: 'Tornade' },
  hurricane: { en: 'Hurricane', fr: 'Ouragan' },
};

/**
 * @description The localized label of a pivot condition.
 * @param {string} condition - The condition.
 * @param {string} language - 'fr' or 'en' (anything else falls back to English).
 * @returns {string} The label.
 * @example
 * conditionLabel('rain', 'fr'); // -> 'Pluie'
 */
function conditionLabel(condition, language) {
  const labels = CONDITION_LABELS[condition] ?? CONDITION_LABELS.unknown;
  return labels[language] ?? labels.en;
}

export {
  ICON_CONDITIONS,
  CONDITION_RANK,
  CONDITION_LABELS,
  parseIcon,
  mostSignificant,
  conditionFromIcon,
  conditionFromText,
  readCondition,
  isDayFromIcon,
  conditionLabel,
};
