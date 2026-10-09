# National Weather Service

This integration brings the **forecasts** and **official alerts** of the National Weather Service (NWS), the weather service of the United States, to Gladys. It feeds the dashboard weather widget, the assistant and the alert-driven scenes, and adds three widgets.

> Community integration, not affiliated with or endorsed by the National Weather Service or NOAA.

## Ready to use

**No configuration is needed**: the NWS API is free and keyless. Install the integration and it works right away.

The NWS covers the **United States and its territories** only (Alaska, Hawaii, Puerto Rico, Guam…). For a house elsewhere, Gladys automatically uses another weather provider.

Set the **location of each house** in its settings: the alert watch, the scene actions and the widgets need it.

## What the integration provides

- **Current conditions** measured at the nearest weather station (temperature, feels-like, humidity, dew point, pressure, wind, gusts, visibility). When no station reported recently, the forecast of the running hour is used.
- **Hourly forecast** for 24 hours: temperature, feels-like, humidity, cloud cover, wind and gusts, rain amount and chance.
- **Daily forecast** for 6 to 7 days: high of the day, low of the following night, sky, chance of rain, amount, wind and gusts.
- **Sunrise and sunset**, computed locally.
- **Official alerts** (watches, warnings, advisories) with their full text and instructions.

The NWS publishes no UV index.

## Alert levels

| Level         | Meaning                                              |
| ------------- | ---------------------------------------------------- |
| **Warning**   | the hazard is happening or imminent: take action now |
| **Watch**     | conditions are favorable for it: be prepared         |
| **Advisory**  | a less serious hazard that may cause inconvenience   |
| **Statement** | information or follow-up                             |

## Alert-driven scenes

Gladys already offers the generic **"Weather alert raised"** and **"Weather alert ended"** triggers. Gladys checks the alerts every 30 minutes; this integration additionally watches them **every minute** and tells Gladys as soon as one changes, so your scene fires within seconds.

The integration adds its own, finer triggers under **National Weather Service** in the scene editor:

| Trigger              | Fires when…                                       | Filters                               |
| -------------------- | ------------------------------------------------- | ------------------------------------- |
| **NWS alert issued** | a new watch, warning or advisory covers the house | house, kind of alert, level, severity |
| **NWS alert ended**  | an alert expired or was cancelled                 | house, kind of alert, level           |

Kinds: tornado, hurricane / tropical storm, severe thunderstorm, flood, winter storm, cold, heat, wind, fire weather, fog, air quality, marine, other.

For instance, to be told about a tornado: trigger **NWS alert issued**, kind **Tornado**, level **Warning**, then a send-message action with the **Summary** and **Instructions** variables.

Good to know:

- The **House** field must hold the house name **exactly** as shown in Gladys. Empty = every house.
- The NWS never edits an alert: it issues a new one replacing the previous. The integration follows these updates: an extended or amended alert does not fire your scene again.
- Alerts already in force when the integration starts fire nothing: only new ones do.
- An alert ends once it is missing from two checks in a row, or as soon as its end time has passed.

## Scene actions

| Action                             | Returns                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Get the NWS alerts**             | number of alerts, warnings, watches and advisories, list of events, the most serious one (kind, level, instructions, end), a summary |
| **Get the NWS forecast of a day**  | today to 6 days ahead: high, low, sky, chance of rain, wind, the forecaster's text (day and night), a summary                        |
| **Get the current NWS conditions** | temperature, feels-like, humidity, dew point, pressure, wind, gusts, visibility, sky, station, a summary                             |

Every action has a **Summary** output, a sentence ready to send in a message.

## Dashboard widgets

| Widget                | Content                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **NWS alerts**        | warnings / watches / advisories counters, then each alert; tap one for its full text and instructions. Refreshed as soon as an alert changes. |
| **NWS text forecast** | the forecaster's narrative, period by period (Tonight, Saturday, Saturday Night…), with the NWS icons                                         |
| **NWS next hours**    | 12, 24 or 48 hours as a curve: temperature and feels-like, chance of rain, or wind and gusts                                                  |

Each widget has a **House** setting (empty = first located house).

## Configuration (optional)

| Setting                      | Default | Role                                                                                                                     |
| ---------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Contact email**            | —       | the NWS asks every application to identify itself; your email lets it reach you before blocking traffic it finds abusive |
| **Cache duration (s)**       | 600     | how long a forecast is reused (the NWS refreshes them about once an hour)                                                |
| **Alert check interval (s)** | 60      | how often the alerts of your houses are checked, 30 to 900 seconds                                                       |
