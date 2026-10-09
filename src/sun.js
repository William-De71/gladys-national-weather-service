// -----------------------------------------------------------------------------
// Sunrise and sunset, computed locally.
//
// The NWS API publishes no sun times, and the Gladys weather widget shows
// them when the payload carries them. They are pure astronomy, so they are
// computed here with the classic sunrise equation (NOAA-style approximation,
// accurate to about a minute at the latitudes the NWS covers) instead of
// calling another service.
//
// The date given is the LOCAL calendar date of the house: the solar transit of
// that date is placed by the longitude, so a Kansas evening that falls on the
// next UTC day still belongs to the right local day.
// -----------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const J2000 = 2451545.0;
const UNIX_EPOCH_JULIAN = 2440587.5;
const OBLIQUITY = 23.4397;
// Refraction and the sun's radius: the upper limb touches the horizon.
const HORIZON = -0.833;

const toRadians = (degrees) => (degrees * Math.PI) / 180;
const toDegrees = (radians) => (radians * 180) / Math.PI;
const fromJulian = (julian) => new Date((julian - UNIX_EPOCH_JULIAN) * DAY_MS);

/**
 * @description Compute the sunrise and sunset of a local calendar date.
 * @param {string} date - The local date, YYYY-MM-DD.
 * @param {number} latitude - Latitude in degrees, north positive.
 * @param {number} longitude - Longitude in degrees, east positive.
 * @returns {{ sunrise: Date, sunset: Date }|null} The two instants, or null
 * when the sun does not rise or does not set that day (polar day or night,
 * northern Alaska) or the input is unusable.
 * @example
 * sunTimes('2026-10-10', 39.75, -97.09); // -> { sunrise: 12:31Z, sunset: 00:03Z next day }
 */
function sunTimes(date, latitude, longitude) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
  if (match === null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  const midnight = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const julianDate = midnight / DAY_MS + UNIX_EPOCH_JULIAN;

  const n = Math.ceil(julianDate - J2000 + 0.0008);
  const meanSolarTime = n - longitude / 360;
  const meanAnomaly = (357.5291 + 0.98560028 * meanSolarTime) % 360;
  const m = toRadians(meanAnomaly);
  const center = 1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m);
  const eclipticLongitude = toRadians((meanAnomaly + center + 180 + 102.9372) % 360);
  const transit =
    J2000 + meanSolarTime + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * eclipticLongitude);
  const declination = Math.asin(Math.sin(eclipticLongitude) * Math.sin(toRadians(OBLIQUITY)));

  const phi = toRadians(latitude);
  const cosHourAngle =
    (Math.sin(toRadians(HORIZON)) - Math.sin(phi) * Math.sin(declination)) /
    (Math.cos(phi) * Math.cos(declination));
  if (!(cosHourAngle >= -1 && cosHourAngle <= 1)) {
    return null;
  }
  const hourAngle = toDegrees(Math.acos(cosHourAngle));
  return {
    sunrise: fromJulian(transit - hourAngle / 360),
    sunset: fromJulian(transit + hourAngle / 360),
  };
}

export { sunTimes };
