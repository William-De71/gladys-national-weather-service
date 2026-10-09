// -----------------------------------------------------------------------------
// Unit conversions between what the NWS publishes and what Gladys asks for.
//
// The NWS speaks two dialects:
//   - the text products (/forecast, /forecast/hourly) in US customary units by
//     default — °F, wind as a "10 to 15 mph" string — or SI with `?units=si`
//     ("20 to 25 km/h");
//   - the quantitative products (/gridpoints raw data, /observations) always
//     in WMO units: degC, km_h-1, Pa, m, mm.
//
// Gladys asks for one of two unit systems (contract B.18): `metric` (°C, m/s,
// hPa, mm, km) or `us` (°F, mph, hPa, in, mi). Pressure stays in hPa in both.
// -----------------------------------------------------------------------------

/**
 * @description Round a number to a given count of decimals.
 * @param {number} value - The value.
 * @param {number} [decimals] - Decimals to keep.
 * @returns {number} The rounded value.
 * @example
 * round(12.345, 1); // -> 12.3
 */
function round(value, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * @description Whether a value is a usable finite number.
 * @param {unknown} value - The value.
 * @returns {boolean} True for a finite number.
 * @example
 * isNumber(null); // -> false
 */
function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * @description Convert a temperature in °C to the requested unit system.
 * @param {number|null} celsius - The temperature in °C.
 * @param {string} units - 'metric' or 'us'.
 * @returns {number|undefined} The converted temperature.
 * @example
 * temperatureFromCelsius(20, 'us'); // -> 68
 */
function temperatureFromCelsius(celsius, units) {
  if (!isNumber(celsius)) {
    return undefined;
  }
  return units === 'us' ? round((celsius * 9) / 5 + 32) : round(celsius);
}

/**
 * @description Convert a temperature in °F to the requested unit system.
 * @param {number|null} fahrenheit - The temperature in °F.
 * @param {string} units - 'metric' or 'us'.
 * @returns {number|undefined} The converted temperature.
 * @example
 * temperatureFromFahrenheit(68, 'metric'); // -> 20
 */
function temperatureFromFahrenheit(fahrenheit, units) {
  if (!isNumber(fahrenheit)) {
    return undefined;
  }
  return units === 'us' ? round(fahrenheit) : round(((fahrenheit - 32) * 5) / 9);
}

/**
 * @description Convert a temperature published with its unit letter ("F" or
 * "C", the `temperatureUnit` of the text products).
 * @param {number|null} value - The temperature.
 * @param {string} unit - 'F' or 'C'.
 * @param {string} units - 'metric' or 'us'.
 * @returns {number|undefined} The converted temperature.
 * @example
 * convertTemperature(17, 'C', 'us'); // -> 62.6
 */
function convertTemperature(value, unit, units) {
  return unit === 'C'
    ? temperatureFromCelsius(value, units)
    : temperatureFromFahrenheit(value, units);
}

/**
 * @description Convert a speed in km/h to the requested unit system.
 * @param {number|null} kmh - The speed in km/h.
 * @param {string} units - 'metric' (m/s) or 'us' (mph).
 * @returns {number|undefined} The converted speed.
 * @example
 * speedFromKmh(36, 'metric'); // -> 10
 */
function speedFromKmh(kmh, units) {
  if (!isNumber(kmh)) {
    return undefined;
  }
  return units === 'us' ? round(kmh / 1.609344) : round(kmh / 3.6);
}

/**
 * @description Convert a speed in mph to the requested unit system.
 * @param {number|null} mph - The speed in mph.
 * @param {string} units - 'metric' (m/s) or 'us' (mph).
 * @returns {number|undefined} The converted speed.
 * @example
 * speedFromMph(10, 'metric'); // -> 4.5
 */
function speedFromMph(mph, units) {
  if (!isNumber(mph)) {
    return undefined;
  }
  return units === 'us' ? round(mph) : round(mph * 0.44704);
}

/**
 * @description Read the wind speed of a text product: "15 mph", "10 to 15
 * mph", "20 to 25 km/h". A range is read as its upper bound: the NWS words its
 * forecasts as "up to", and the upper bound is the figure people plan for.
 * @param {string|null} text - The windSpeed string.
 * @param {string} units - 'metric' or 'us'.
 * @returns {number|undefined} The speed in the requested unit system.
 * @example
 * parseWindSpeed('10 to 15 mph', 'metric'); // -> 6.7
 */
function parseWindSpeed(text, units) {
  if (typeof text !== 'string') {
    return undefined;
  }
  const numbers = text.match(/\d+(?:\.\d+)?/g);
  if (numbers === null) {
    return undefined;
  }
  const value = Math.max(...numbers.map(Number));
  return /km\/h/i.test(text) ? speedFromKmh(value, units) : speedFromMph(value, units);
}

// The 16 compass points the text products use for windDirection.
const COMPASS_POINTS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];

/**
 * @description Convert a compass point ("SSW") to degrees.
 * @param {string|null} point - The compass point.
 * @returns {number|undefined} Degrees, 0 = north.
 * @example
 * compassToDegrees('SW'); // -> 225
 */
function compassToDegrees(point) {
  const index = COMPASS_POINTS.indexOf(String(point ?? '').toUpperCase());
  return index === -1 ? undefined : index * 22.5;
}

/**
 * @description Convert degrees to the nearest of the 16 compass points.
 * @param {number|null} degrees - Degrees, 0 = north.
 * @returns {string|undefined} The compass point.
 * @example
 * degreesToCompass(200); // -> 'SSW'
 */
function degreesToCompass(degrees) {
  if (!isNumber(degrees)) {
    return undefined;
  }
  const index = Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS_POINTS[index];
}

/**
 * @description Convert a pressure in Pa to hPa (both unit systems).
 * @param {number|null} pascal - The pressure in Pa.
 * @returns {number|undefined} The pressure in hPa.
 * @example
 * pressureFromPascal(101325); // -> 1013.3
 */
function pressureFromPascal(pascal) {
  return isNumber(pascal) ? round(pascal / 100) : undefined;
}

/**
 * @description Convert a distance in meters to km (metric) or miles (us).
 * @param {number|null} meters - The distance in m.
 * @param {string} units - 'metric' or 'us'.
 * @returns {number|undefined} The converted distance.
 * @example
 * distanceFromMeters(16090, 'us'); // -> 10
 */
function distanceFromMeters(meters, units) {
  if (!isNumber(meters)) {
    return undefined;
  }
  return units === 'us' ? round(meters / 1609.344) : round(meters / 1000);
}

/**
 * @description Convert a precipitation amount in mm to mm (metric) or inches (us).
 * @param {number|null} mm - The amount in mm.
 * @param {string} units - 'metric' or 'us'.
 * @returns {number|undefined} The converted amount.
 * @example
 * precipitationFromMm(25.4, 'us'); // -> 1
 */
function precipitationFromMm(mm, units) {
  if (!isNumber(mm)) {
    return undefined;
  }
  return units === 'us' ? round(mm / 25.4, 2) : round(mm, 1);
}

/**
 * @description The display units of a unit system.
 * @param {string} units - 'metric' or 'us'.
 * @returns {{ temperature: string, speed: string, precipitation: string }} The unit labels.
 * @example
 * unitLabels('us'); // -> { temperature: '°F', speed: 'mph', precipitation: 'in' }
 */
function unitLabels(units) {
  return units === 'us'
    ? { temperature: '°F', speed: 'mph', precipitation: 'in' }
    : { temperature: '°C', speed: 'km/h', precipitation: 'mm' };
}

/**
 * @description Convert a pivot wind speed (m/s in metric, mph in us) to the
 * figure people read: km/h in metric, mph in us. Used for the texts and the
 * widgets, never for the pivot payload.
 * @param {number|undefined} speed - The pivot speed.
 * @param {string} units - 'metric' or 'us'.
 * @returns {number|undefined} The displayed speed, rounded.
 * @example
 * displaySpeed(10, 'metric'); // -> 36
 */
function displaySpeed(speed, units) {
  if (!isNumber(speed)) {
    return undefined;
  }
  return units === 'us' ? Math.round(speed) : Math.round(speed * 3.6);
}

export {
  round,
  isNumber,
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
  unitLabels,
  displaySpeed,
};
