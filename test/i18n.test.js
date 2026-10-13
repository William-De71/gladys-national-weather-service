import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { LANGUAGES, formatPercent, inSentence } from '../src/i18n.js';
import { CATEGORY_LABELS, LEVEL_LABELS, SEVERITY_LABELS, readAlerts } from '../src/alerts.js';
import { CONDITION_LABELS } from '../src/conditions.js';
import { SUMMARIES, buildIssuedData, buildEndedData } from '../src/alert-watcher.js';
import {
  SENTENCES,
  buildAlertsOutputs,
  buildForecastOutputs,
  buildCurrentOutputs,
} from '../src/scene-actions.js';
import {
  TEXTS,
  HOURLY_METRICS,
  buildAlertsWidget,
  buildForecastWidget,
  buildHourlyWidget,
  messageContent,
  text,
} from '../src/widgets.js';
import { buildWeather } from '../src/weather.js';
import { feature } from './helpers/alert-feature.js';
import { fixtures, NOW, LATITUDE, LONGITUDE, TIME_ZONE } from './helpers/fixtures.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const manifest = JSON.parse(read('../gladys-assistant-integration.json'));
const HOUSE = { name: 'Home', latitude: LATITUDE, longitude: LONGITUDE };

/**
 * @description Every multi-language object of the manifest, with its path.
 * @param {unknown} node - A manifest node.
 * @param {string} path - Its path.
 * @returns {Array<[string, object]>} The texts.
 */
function texts(node, path = '') {
  if (Array.isArray(node)) {
    return node.flatMap((child, i) => texts(child, `${path}[${i}]`));
  }
  if (node && typeof node === 'object') {
    if (typeof node.en === 'string') {
      return [[path, node]];
    }
    return Object.entries(node).flatMap(([key, child]) => texts(child, `${path}.${key}`));
  }
  return [];
}

test('every manifest text exists in English, French, German and Spanish', () => {
  const found = texts(manifest);
  assert.ok(found.length > 100);
  for (const [path, entry] of found) {
    assert.deepEqual(Object.keys(entry), LANGUAGES, path);
    for (const language of LANGUAGES) {
      assert.ok(entry[language]?.trim(), `${path}.${language} is missing`);
    }
  }
});

test('catalog description: 10 to 100 characters per language', () => {
  for (const language of LANGUAGES) {
    const { length } = manifest.description[language];
    assert.ok(length >= 10 && length <= 100, `description.${language}: ${length}`);
  }
});

test('widget labels: 3 to 30 characters per language', () => {
  for (const widget of manifest.widgets) {
    for (const language of LANGUAGES) {
      const { length } = widget.label[language];
      assert.ok(length >= 3 && length <= 30, `${widget.key}.label.${language}: ${length}`);
    }
  }
});

test('the manifest stays under the 100 KB of the store', () => {
  assert.ok(Buffer.byteLength(read('../gladys-assistant-integration.json')) < 100 * 1024);
});

test('every runtime label exists in the four languages, with the same placeholders', () => {
  const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const table of [TEXTS, CATEGORY_LABELS, LEVEL_LABELS, SEVERITY_LABELS, CONDITION_LABELS]) {
    for (const [key, entry] of Object.entries(table)) {
      for (const language of LANGUAGES) {
        assert.ok(entry[language], `${key}.${language} is missing`);
        assert.deepEqual(
          placeholders(entry[language]),
          placeholders(entry.en),
          `${key}.${language}`,
        );
      }
    }
  }
});

test('every scene sentence exists in the four languages', () => {
  for (const table of [SENTENCES, SUMMARIES]) {
    assert.deepEqual(Object.keys(table), LANGUAGES);
    for (const language of LANGUAGES) {
      assert.deepEqual(Object.keys(table[language]), Object.keys(table.en), language);
    }
  }
});

test('the widgets are valid in every language, messages included', () => {
  const f = fixtures();
  const alerts = readAlerts(
    [
      feature({ id: 'tor' }),
      feature({ id: 'watch', event: 'Tornado Watch', severity: 'Severe' }),
      feature({ id: 'heat', event: 'Heat Advisory', severity: 'Moderate' }),
    ],
    NOW,
  );
  for (const language of LANGUAGES) {
    const common = { house: HOUSE, place: 'Linn, KS', timeZone: TIME_ZONE, language };
    const contents = [
      buildAlertsWidget({ ...common, alerts }),
      buildAlertsWidget({ ...common, alerts: [] }),
      buildForecastWidget({
        ...common,
        forecast: f.forecast,
        units: 'us',
        showIcons: true,
        now: NOW,
      }),
      ...HOURLY_METRICS.map((metric) =>
        buildHourlyWidget({
          ...common,
          hourly: f.hourly,
          grid: f.grid,
          units: 'metric',
          settings: { metric, hours: '24' },
          now: NOW,
        }),
      ),
      ...['noHouse', 'outOfCoverage', 'noForecast'].map((key) =>
        messageContent(text(key, language), 120),
      ),
    ];
    for (const content of contents) {
      assert.deepEqual(validateWidgetContent(content), [], language);
    }
  }
});

test('the forecast periods are titled in the user language', () => {
  const { forecast } = fixtures();
  const titles = (language) =>
    buildForecastWidget({
      forecast,
      house: HOUSE,
      place: null,
      timeZone: TIME_ZONE,
      language,
      units: 'us',
      showIcons: false,
      now: NOW,
    })
      .components.find((component) => component.type === 'card-list')
      .items.map((item) => item.title);
  assert.ok(titles('de').includes('Samstagnacht'), titles('de').join(', '));
  assert.ok(titles('es').includes('Noche del sábado'), titles('es').join(', '));
  assert.ok(titles('fr').includes('Nuit de samedi'), titles('fr').join(', '));
});

test('the scene texts follow the language, the NWS names stay in English', () => {
  const [alert] = readAlerts([feature({})], NOW);
  const context = (language) => ({ house: 'Haus', language, timeZone: TIME_ZONE });
  assert.equal(
    buildIssuedData(alert, context('de')).summary,
    'NWS „Tornado Warning“ (Tornado, Stufe Warnung) für Haus bis Fr., 18:45.',
  );
  assert.equal(
    buildIssuedData(alert, context('es')).summary,
    'NWS «Tornado Warning» (tornado, nivel aviso) para Haus hasta vie, 18:45.',
  );
  assert.equal(
    buildEndedData(alert, context('de')).summary,
    'Die NWS-Warnung „Tornado Warning“ für Haus ist beendet.',
  );
  assert.equal(buildIssuedData(alert, context('es')).level_label, 'Aviso');

  assert.equal(
    buildAlertsOutputs({ alerts: [], house: 'Casa', timeZone: null, language: 'es' }).summary,
    'Ninguna alerta NWS en vigor para Casa.',
  );

  const { forecast, observation } = fixtures();
  const outputs = (language) =>
    buildForecastOutputs({
      forecast,
      timeZone: TIME_ZONE,
      house: 'Haus',
      language,
      units: 'us',
      day: '1',
      now: NOW,
    });
  assert.equal(
    outputs('de').summary,
    'Wetter morgen in Haus: Klarer Himmel, Höchstwert 87°F, Tiefstwert 64°F.',
  );
  assert.equal(
    outputs('es').summary,
    'Tiempo mañana en Haus: cielo despejado, máxima 87°F, mínima 64°F.',
  );
  assert.equal(outputs('de').name, 'Samstag');

  const f = fixtures();
  const weather = buildWeather(
    {
      point: f.point,
      observation: observation.properties,
      hourly: f.hourly,
      forecast: f.forecast,
      grid: f.grid,
      alerts: [],
    },
    { units: 'metric', latitude: LATITUDE, longitude: LONGITUDE },
  );
  const current = buildCurrentOutputs({
    weather,
    observation: observation.properties,
    house: 'Casa',
    timeZone: TIME_ZONE,
    language: 'es',
    units: 'metric',
  });
  assert.match(current.summary, /^En Casa: -?\d+°C, .+ \(observado a las \d{2}:\d{2}\)\.$/);
});

test('percentages and labels inside sentences follow the typography of each language', () => {
  assert.equal(formatPercent(40, 'en'), '40%');
  assert.equal(formatPercent(40, 'de'), '40 %');
  assert.equal(formatPercent(40, 'it'), '40%');
  assert.equal(inSentence('Regen', 'de'), 'Regen');
  assert.equal(inSentence('Lluvia', 'es'), 'lluvia');
});

const READMES = { en: 'README.md', fr: 'README.fr.md', de: 'README.de.md', es: 'README.es.md' };

test('docs: English and French mandatory, the four languages with the same structure', () => {
  const headings = (value) => value.split('\n').filter((line) => /^#{1,3} /.test(line)).length;
  const tables = (value) => value.split('\n').filter((line) => /^\|\s*-/.test(line)).length;
  const docs = Object.fromEntries(
    LANGUAGES.map((language) => {
      const path = new URL(`../docs/${language}.md`, import.meta.url);
      assert.ok(existsSync(path), `docs/${language}.md is missing`);
      return [language, readFileSync(path, 'utf8')];
    }),
  );
  for (const language of LANGUAGES) {
    assert.ok(docs[language].length > 300, `docs/${language}.md is too short`);
    assert.equal(headings(docs[language]), headings(docs.en), `docs/${language}.md headings`);
    assert.equal(tables(docs[language]), tables(docs.en), `docs/${language}.md tables`);
    assert.ok(!docs[language].includes('cover.jpg'), 'the store already shows the cover');
  }
});

test('README: one per language, each linking to the three others, with badges and cover', () => {
  for (const [language, file] of Object.entries(READMES)) {
    const path = new URL(`../${file}`, import.meta.url);
    assert.ok(existsSync(path), `${file} is missing`);
    const content = readFileSync(path, 'utf8');
    for (const other of Object.values(READMES).filter((name) => name !== file)) {
      assert.ok(content.includes(`](${other})`), `${file} does not link to ${other}`);
    }
    assert.ok(content.includes(`](docs/${language}.md)`), `${file}: user documentation`);
    assert.match(content, /\n!\[[^\]]+\]\(cover\.jpg\)\n/, `${file}: cover`);
    // The four badges, the cover right below them.
    const badges = content.indexOf('img.shields.io/badge/');
    assert.ok(badges > 0 && badges < content.indexOf('](cover.jpg)'), `${file}: badges first`);
    for (const badge of ['Apache--2.0', 'github/v/release', 'actions/workflow/status', 'Gladys-']) {
      assert.ok(content.includes(badge), `${file}: badge ${badge}`);
    }
  }
});
