# Gladys National Weather Service

External [Gladys Assistant](https://gladysassistant.com) integration providing **National Weather Service**
forecasts, the official **watches, warnings and advisories**, alert-driven **scenes** and **dashboard widgets** for
houses in the United States, built on `@gladysassistant/integration-sdk` 0.14.

**Zero configuration**: the NWS API (`api.weather.gov`) is free and needs no key. Install the integration and it
works.

User documentation: [English](docs/en.md) · [Français](docs/fr.md).

> Community integration, not affiliated with or endorsed by the National Weather Service or NOAA.

## Features

### Weather provider

A weather provider (manifest `type: "weather"`, spec B.18): no devices, no discovery screens. Gladys asks it for
the weather of a house and it feeds the **dashboard weather widget**, the **chat assistant** and the core's
**weather-alert scene triggers**. Installed, it takes over from OpenWeather automatically; for a house outside the
United States it fails cleanly and Gladys falls through to the next provider.

Four NWS products are merged, each for what it does best:

- **Current conditions**: the latest observation of the nearest station (temperature, humidity, dew point,
  pressure, wind, gusts, visibility, feels-like). A station that has not reported for 2 hours, or reports no
  temperature, is skipped for the next one; without any, the forecast of the running hour is used.
- **Hourly forecast** (next 24 hours): temperature, feels-like, humidity, cloud cover, wind speed/gust/direction,
  precipitation amount and probability — the text forecast enriched with the raw forecast grid.
- **Daily forecast** (6–7 days): high of the day period and low of the night that follows (as the NWS pairs them),
  condition, chance of rain, precipitation amount, wind and gusts.
- **Sunrise and sunset**: computed locally (the NWS API publishes none); they also drive the day/night icons.
- **Units**: metric or US, as Gladys asks.
- No UV index: the NWS API does not publish one.

### Alerts

- **Official alerts** in CAP, the format Gladys uses: severity (`extreme`, `severe`, `moderate`, `minor`) and event
  name kept as published, typed for the core (tornado → thunderstorm, hurricane → wind, flood, snow, heat, cold,
  fog, coastal…), with headline, description and instructions.
- **Fast**: the integration checks the alerts of every located house every minute (configurable) and nudges Gladys
  on every change — the core weather-alert trigger fires within seconds instead of its 30-minute floor.

### Scene triggers

| Trigger              | Fires when…                                                              | Filters                                      |
| -------------------- | ------------------------------------------------------------------------ | -------------------------------------------- |
| **NWS alert issued** | a new watch, warning or advisory covers the house (updates don't refire) | house, kind (13 categories), level, severity |
| **NWS alert ended**  | an alert expired or was cancelled                                        | house, kind, level                           |

Kinds: tornado, hurricane / tropical, severe thunderstorm, flood, winter storm, cold, heat, wind, fire weather, fog,
air quality, marine, other. Levels: warning, watch, advisory, statement, other. Variables: event, kind, level,
severity, urgency, certainty, headline, area, start and end (local time), instructions, description, summary.

An alert is followed through its updates (the NWS issues a new alert referencing the one it replaces); an alert
ends once missing from two checks in a row or past its end time; the first check after a start is a baseline.

### Scene actions

| Action                             | Outputs                                                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Get the NWS alerts**             | count, warnings / watches / advisories, events, the most serious one (event, kind, level, severity, headline, instructions, end), summary |
| **Get the NWS forecast of a day**  | today to day 6: high, low, sky, chance of rain, wind, the forecaster's day and night texts, summary                                       |
| **Get the current NWS conditions** | temperature, feels-like, humidity, dew point, pressure, wind, gusts, visibility, sky, station, summary                                    |

### Dashboard widgets

| Widget                | Content                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **NWS alerts**        | warnings / watches / advisories counters, each alert with its full text and instructions in the detail panel; refreshed on every change |
| **NWS text forecast** | the forecaster's narrative, period by period ("Tonight", "Saturday"…), with the NWS icons                                               |
| **NWS next hours**    | 12, 24 or 48 hours as a curve: temperature and feels-like, chance of rain, or wind and gusts, extremes annotated                        |

The NWS writes in English only: event names, narratives and alert texts stay in English; everything around them
follows the user's language (English or French).

## Configuration

All optional:

| Field                    | Default | Role                                                                                            |
| ------------------------ | ------- | ----------------------------------------------------------------------------------------------- |
| Contact email            | —       | added to the `User-Agent` the NWS requires, so it can reach you before blocking abusive traffic |
| Cache duration (s)       | 600     | how long a forecast is reused (0–3600)                                                          |
| Alert check interval (s) | 60      | how often the alerts of the houses are checked (30–900)                                         |

## House location

The weather path gets its coordinates from Gladys. The alert watcher, the scene actions and the widgets read the
**houses** of Gladys (`location: true`): set the location of each house in its settings. A "House" field takes
the house name as shown in Gladys; empty means the first located house.

## Calls to the NWS

Every request carries `User-Agent: gladys-nws/<version> (https://github.com/William-De71/gladys-nws[, contact])`.

| Endpoint                                  | Kept             |
| ----------------------------------------- | ---------------- |
| `/points/{lat},{lon}`                     | 24 h             |
| `/gridpoints/…/stations`                  | 24 h             |
| `/stations/{id}/observations/latest`      | cache (≤ 10 min) |
| `/gridpoints/…/forecast/hourly`           | cache            |
| `/gridpoints/…/forecast[?units=si]`       | cache            |
| `/gridpoints/{office}/{x},{y}` (raw grid) | cache            |
| `/alerts/active?point={lat},{lon}`        | 60 s             |
| `/icons/…` (widget icons)                 | 24 h             |

Concurrent calls share one request; a 5xx or network failure is retried once. The forecast, grid, observation and
alerts are optional for the weather payload: their failure costs detail, never the answer.

## Coverage

The United States and its territories (Alaska, Hawaii, Puerto Rico, Guam…). Elsewhere `/points` answers 404: the
weather request fails with `OutOfCoverageError` and Gladys uses its next weather provider; the widgets show an
explanatory message; the alert watcher skips the house for a day.

## Development

```bash
npm install
npm test            # node --test, real NWS answers as fixtures (test/fixtures)
npm run lint
npm run format:check
```

Layout:

- `index.js` — wiring: weather provider, scene actions, widgets, alert watcher, lifecycle.
- `src/nws-api.js` — HTTP client: User-Agent, caches, retry, coalescing.
- `src/weather.js` — NWS products → pivot payload; `src/gridpoint.js` raw grid; `src/sun.js` sun times.
- `src/conditions.js` — NWS icons and texts → pivot conditions.
- `src/alerts.js` — CAP alerts, categories, levels, pivot alerts.
- `src/alert-watcher.js` — alert episodes, scene triggers, nudges.
- `src/scene-actions.js`, `src/widgets.js` — scene outputs and widget contents.

Release: Actions → Release → patch / minor / major (bumps `package.json` and the manifest, writes the changelog,
tags, builds the multi-arch image `ghcr.io/william-de71/gladys-nws`). The ghcr package must be public.

## Requirements

- Gladys **5.1.1** or later (weather type, scene triggers and actions, dashboard widgets).
- Node.js 20+ for development; the image runs Node 24.

## License

Apache-2.0.
