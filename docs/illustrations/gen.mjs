// Builds the widget contents of the illustrations with the integration's own
// code: node gen.mjs <repo> <out.json> (run by render.sh)
//
// The forecasts are real NWS answers for Linn, Kansas (test/fixtures, captured
// on 2026-10-09 at 23:15 UTC); the alerts are made up but shaped like real
// ones (a stormy evening: a Tornado Warning, the Tornado Watch around it, a
// Flood Watch starting the next day, a Wind Advisory).
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(`${repo}/${path}`).href);
const { buildAlertsWidget, buildForecastWidget, buildHourlyWidget, iconPathFromKey } =
  await load('src/widgets.js');
const { readAlerts } = await load('src/alerts.js');
const { placeName } = await load('src/weather.js');
const { LANGUAGES } = await load('src/i18n.js');
const { fixtures, NOW, LATITUDE, LONGITUDE, TIME_ZONE } = await load('test/helpers/fixtures.js');
const { feature } = await load('test/helpers/alert-feature.js');
const manifest = JSON.parse(readFileSync(`${repo}/gladys-assistant-integration.json`, 'utf8'));

const HOUSE = { name: 'Home', latitude: LATITUDE, longitude: LONGITUDE };
const f = fixtures();
const place = placeName(f.point);

const alerts = readAlerts(
  [
    feature({
      id: 'tor',
      onset: '2026-10-09T18:05:00-05:00',
      ends: '2026-10-09T18:45:00-05:00',
      headline: 'Tornado Warning issued October 9 at 6:05PM CDT until October 9 at 6:45PM CDT',
    }),
    feature({
      id: 'watch',
      event: 'Tornado Watch',
      severity: 'Severe',
      urgency: 'Expected',
      certainty: 'Possible',
      onset: '2026-10-09T15:30:00-05:00',
      ends: '2026-10-09T23:00:00-05:00',
      instruction: null,
    }),
    feature({
      id: 'flood',
      event: 'Flood Watch',
      severity: 'Moderate',
      urgency: 'Future',
      certainty: 'Possible',
      onset: '2026-10-10T07:00:00-05:00',
      ends: '2026-10-11T07:00:00-05:00',
      instruction: 'You should monitor later forecasts and be prepared to take action.',
    }),
    feature({
      id: 'wind',
      event: 'Wind Advisory',
      severity: 'Minor',
      urgency: 'Expected',
      certainty: 'Likely',
      onset: '2026-10-09T16:00:00-05:00',
      ends: '2026-10-09T22:00:00-05:00',
      instruction:
        'Use extra caution when driving, especially if operating a high profile vehicle.',
    }),
  ],
  NOW,
);

const contents = {};
for (const language of LANGUAGES) {
  const common = { house: HOUSE, place, timeZone: TIME_ZONE, language, now: NOW };
  contents[language] = {
    alerts: buildAlertsWidget({ ...common, alerts }),
    forecast: buildForecastWidget({
      ...common,
      forecast: language === 'en' ? f.forecast : f.forecastSi,
      units: language === 'en' ? 'us' : 'metric',
      showIcons: true,
    }),
    hourly: buildHourlyWidget({
      ...common,
      hourly: f.hourly,
      grid: f.grid,
      units: language === 'en' ? 'us' : 'metric',
      settings: { metric: 'temperature', hours: '24' },
    }),
  };
}

// The NWS icons the forecast shows, for render.sh to download.
const icons = {};
for (const content of Object.values(contents)) {
  for (const component of content.forecast.components) {
    for (const item of component.items ?? []) {
      if (item.image) {
        icons[item.image] = iconPathFromKey(item.image);
      }
    }
  }
}

const cards = Object.fromEntries(
  manifest.widgets.map((widget) => [widget.key, { label: widget.label, icon: widget.icon }]),
);
writeFileSync(out, JSON.stringify({ now: NOW, cards, icons, contents }));
