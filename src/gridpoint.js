// -----------------------------------------------------------------------------
// Reading the raw forecast grid (/gridpoints/{office}/{x},{y}).
//
// The text forecasts round everything and leave out what Gladys can show: wind
// gusts, cloud cover, feels-like temperature, precipitation amounts. The raw
// grid has them all, in WMO units, as layers of time intervals:
//
//   "windGust": { "uom": "wmoUnit:km_h-1", "values": [
//     { "validTime": "2026-10-09T17:00:00+00:00/PT2H", "value": 35.188 }, ... ] }
//
// An interval is an ISO 8601 start and duration; consecutive equal values are
// merged by the NWS, so one entry can cover anything from an hour to days.
// Amounts (precipitation) cover their whole interval and are prorated when a
// window only overlaps part of it.
// -----------------------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;

/**
 * @description Parse an ISO 8601 duration of the grid ("PT1H", "P4DT2H", "PT30M").
 * @param {string} duration - The duration.
 * @returns {number|null} Milliseconds, or null when unreadable.
 * @example
 * parseDuration('P1DT6H'); // -> 108000000
 */
function parseDuration(duration) {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(String(duration));
  if (match === null || match[0] === 'P' || match[0] === 'PT') {
    return null;
  }
  const [, days = 0, hours = 0, minutes = 0] = match;
  return ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 * 1000;
}

/**
 * @description Parse the intervals of a grid layer.
 * @param {object|undefined} layer - The layer ({ uom, values }).
 * @returns {Array<{ start: number, end: number, value: number }>} The intervals
 * with a finite value, in ms since the epoch.
 * @example
 * readLayer(grid.properties.windGust);
 */
function readLayer(layer) {
  if (!layer || !Array.isArray(layer.values)) {
    return [];
  }
  return layer.values
    .map((entry) => {
      const [startText, durationText] = String(entry?.validTime ?? '').split('/');
      const start = Date.parse(startText);
      const duration = parseDuration(durationText);
      if (!Number.isFinite(start) || duration === null || typeof entry.value !== 'number') {
        return null;
      }
      return { start, end: start + duration, value: entry.value };
    })
    .filter((interval) => interval !== null && Number.isFinite(interval.value));
}

/**
 * @description The value of a layer at an instant.
 * @param {Array<object>} intervals - The readLayer() intervals.
 * @param {number} instant - Milliseconds since the epoch.
 * @returns {number|undefined} The value, undefined when no interval covers it.
 * @example
 * valueAt(readLayer(grid.properties.skyCover), Date.now());
 */
function valueAt(intervals, instant) {
  const interval = intervals.find(({ start, end }) => start <= instant && instant < end);
  return interval === undefined ? undefined : interval.value;
}

/**
 * @description The intervals of a layer overlapping a window.
 * @param {Array<object>} intervals - The readLayer() intervals.
 * @param {number} from - Window start, ms.
 * @param {number} to - Window end, ms.
 * @returns {Array<object>} The overlapping intervals.
 * @example
 * overlapping(intervals, from, to);
 */
function overlapping(intervals, from, to) {
  return intervals.filter(({ start, end }) => start < to && end > from);
}

/**
 * @description The highest value of a layer over a window.
 * @param {Array<object>} intervals - The readLayer() intervals.
 * @param {number} from - Window start, ms.
 * @param {number} to - Window end, ms.
 * @returns {number|undefined} The maximum, undefined when nothing overlaps.
 * @example
 * maxOver(readLayer(grid.properties.windGust), from, to);
 */
function maxOver(intervals, from, to) {
  const values = overlapping(intervals, from, to).map(({ value }) => value);
  return values.length === 0 ? undefined : Math.max(...values);
}

/**
 * @description The amount of an accumulation layer over a window, each
 * interval prorated by the part of it inside the window.
 * @param {Array<object>} intervals - The readLayer() intervals.
 * @param {number} from - Window start, ms.
 * @param {number} to - Window end, ms.
 * @returns {number|undefined} The amount, undefined when nothing overlaps.
 * @example
 * sumOver(readLayer(grid.properties.quantitativePrecipitation), from, to);
 */
function sumOver(intervals, from, to) {
  const parts = overlapping(intervals, from, to);
  if (parts.length === 0) {
    return undefined;
  }
  return parts.reduce((total, { start, end, value }) => {
    const covered = Math.min(end, to) - Math.max(start, from);
    return total + (value * covered) / (end - start);
  }, 0);
}

/**
 * @description Read the layers of a grid payload Gladys uses, once.
 * @param {object|null} grid - The /gridpoints payload (null when unavailable).
 * @returns {object} The parsed layers (empty arrays when the grid is missing).
 * @example
 * const layers = readGrid(grid);
 */
function readGrid(grid) {
  const properties = grid?.properties ?? {};
  return {
    apparentTemperature: readLayer(properties.apparentTemperature),
    relativeHumidity: readLayer(properties.relativeHumidity),
    skyCover: readLayer(properties.skyCover),
    windSpeed: readLayer(properties.windSpeed),
    windGust: readLayer(properties.windGust),
    windDirection: readLayer(properties.windDirection),
    quantitativePrecipitation: readLayer(properties.quantitativePrecipitation),
  };
}

export { HOUR_MS, parseDuration, readLayer, valueAt, maxOver, sumOver, readGrid };
