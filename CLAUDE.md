# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** of type `weather`: it answers the
weather requests of Gladys with the forecasts of the
[National Weather Service](https://www.weather.gov/documentation/services-web-api)
(United States only), watches the official alerts of every located house for
two scene triggers, and adds three scene actions and three dashboard widgets.
A Node.js service (Node 22+, ESM, no build step) that runs in its own
sandboxed Docker container and talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).
The NWS API is free and keyless: nothing to configure.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/widgets.test.js          # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store . --skip-image-check   # store checks
node .github/scripts/release.mjs plan     # the version the next release would get
```

## Architecture

```
index.js                SDK wiring only: handlers registered before connect()
src/nws-api.js          the NWS client: User-Agent, cache, retries, errors
src/weather.js          NWS products -> the pivot weather of Gladys
src/conditions.js       NWS icons and texts -> pivot conditions, their labels
src/units.js            units of the NWS (WMO codes) -> metric / US
src/gridpoint.js        the raw grid layers (gusts, amounts, cloud cover…)
src/sun.js              sunrise and sunset (no NWS endpoint for them)
src/alerts.js           CAP alerts: category, level, severity, pivot alerts
src/alert-watcher.js    the scene triggers alert_issued / alert_ended
src/scene-actions.js    the outputs of get_alerts, get_forecast, get_current
src/widgets.js          the three dashboard widgets and the icon image keys
src/houses.js           the located houses of Gladys
src/time.js             local dates and times of the house
src/config.js           configuration, last language and unit system
gladys-assistant-integration.json   manifest
docs/{en,fr,de,es}.md   user documentation, re-hosted by the store
.github/scripts/release.mjs         version, changelog, bump (tested in test/)
```

## Rules

- **Keys are forever**: the keys of `config_schema`, widgets and their
  settings, scene triggers (fields, option values, variables) and scene
  actions (fields, option values, outputs), the keys of the scene event data,
  and the icon image keys (`nws-day-tsraqhi-40`) the core caches.
  `test/structure.test.js` compares them to `test/fixtures/discovery.baseline.json`:
  never update the baseline to make a test pass without a documented migration.
- **The container rootfs is read-only.** Write only under `/data` (nothing is
  written today: the last language and unit system go to the config).
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
- **Changelog.** Never edit CHANGELOG.md by hand, it is generated at the
  release. Write the PR title as the line the user will read.
- **Commits and PR titles** follow Conventional Commits, in English: `feat` ->
  minor, `fix` / `perf` -> patch, `!` or `BREAKING CHANGE:` -> major (minor
  below 1.0.0); `docs`, `chore`, `ci`, `test`, `style`, `refactor`, `build`
  release nothing. Scope `security` lands under "Security", a description
  starting with "remove" / "drop" under "Removed".
- **Manifest.** Texts are objects `{ "en", "fr", ... }`; the catalog
  `description` holds 10 to 100 characters per language, the whole file stays
  under the 100 KB of the store. A field older cores do not know needs a
  higher `gladys_version` minimum (see `src/constants.js` of the
  integration-store).
- **The NWS.** Every request carries the User-Agent it requires (see
  nws-api.js); its texts (event names, narratives, alert bodies) are in
  English only and stay so, everything around them follows the user language.
- **Scenes.** Never fire a scene trigger as a consequence of a scene action.
  The first check after a start is a baseline (no event); an update of an
  alert is not a new alert (see alert-watcher.js).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
