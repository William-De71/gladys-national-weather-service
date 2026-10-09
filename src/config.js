// -----------------------------------------------------------------------------
// Configuration of the National Weather Service integration.
//
// Nothing is required: the NWS API is free and keyless. Three optional
// fields:
//   - `contact`: an email (or URL) added to the User-Agent. The NWS asks every
//     application to identify itself with a way to reach its operator, so it
//     can warn before blocking a misbehaving client; the integration already
//     sends its own project URL, this is the user's own, recommended addition;
//   - `cache_duration`: how long a forecast is reused (forecasts are refreshed
//     about once an hour upstream);
//   - `alert_check_interval`: how often the official alerts are checked, for
//     the scene triggers, the alerts widget and the core weather-alert trigger.
// -----------------------------------------------------------------------------

// Bounds and defaults, mirrored from the manifest `config_schema`.
const CACHE_DURATION = { min: 0, max: 3600, default: 600 };
const ALERT_CHECK_INTERVAL = { min: 30, max: 900, default: 60 };
const MAX_CONTACT_LENGTH = 100;

/**
 * @description Read a bounded number field, falling back to its default.
 * @param {unknown} raw - The raw value (the form can send numbers as strings).
 * @param {{ min: number, max: number, default: number }} bounds - The bounds.
 * @returns {number} The value.
 * @example
 * readNumber('900', CACHE_DURATION); // -> 900
 */
function readNumber(raw, bounds) {
  const value = Number(raw ?? bounds.default);
  if (raw === '' || !Number.isFinite(value)) {
    return bounds.default;
  }
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

/**
 * @description Read the contact: printable characters only (it ends up in an
 * HTTP header, where a line break would be an injection).
 * @param {unknown} raw - The raw value.
 * @returns {string} The cleaned contact, '' when absent.
 * @example
 * readContact(' me@example.com '); // -> 'me@example.com'
 */
function readContact(raw) {
  if (typeof raw !== 'string') {
    return '';
  }
  return raw
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[()]/g, '')
    .trim()
    .slice(0, MAX_CONTACT_LENGTH);
}

/**
 * @description Normalize the raw config object from the host API.
 * @param {object} [rawConfig] - The raw config_schema values.
 * @returns {{ contact: string, cacheDuration: number, alertCheckInterval: number }}
 * The normalized config (durations in seconds).
 * @example
 * normalizeConfig({ contact: 'me@example.com' });
 */
function normalizeConfig(rawConfig = {}) {
  const config = rawConfig ?? {};
  return {
    contact: readContact(config.contact),
    cacheDuration: readNumber(config.cache_duration, CACHE_DURATION),
    alertCheckInterval: readNumber(config.alert_check_interval, ALERT_CHECK_INTERVAL),
  };
}

export { CACHE_DURATION, ALERT_CHECK_INTERVAL, normalizeConfig, readContact };
