// Renders integration widget contents the way the Gladys front does
// (front/src/components/boxs/external-widget, ExternalWidgetBox +
// WidgetComponents), in plain DOM, with the same slots, order, class names
// and ApexCharts options. Only the components these widgets use: text,
// value, card-list (with images), chart, button.
// Query: ?lang=fr&cards=alerts,forecast,hourly&theme=dark
/* global ApexCharts, DATA */
const params = new URLSearchParams(location.search);
const LANG = params.get('lang') || 'en';
const CARDS = (params.get('cards') || 'alerts').split(',');
// dashboard.boxes.external-widget.now in the Gladys translations
const NOW_LABEL = { en: 'Now', fr: 'Maintenant', de: 'Jetzt', es: 'Ahora' };

// The "now" of the contents: the chart "now" marker matches it.
const realNow = Date.now;
Date.now = () => DATA.now;

const text = (value) =>
  value && typeof value === 'object' ? (value[LANG] ?? value.en ?? '') : (value ?? '');
const formatNumber = (value) =>
  typeof value === 'number'
    ? new Intl.NumberFormat(LANG, { maximumFractionDigits: 2 }).format(value)
    : text(value);
const COLOR = {
  neutral: 'colorNeutral',
  primary: 'colorPrimary',
  success: 'colorSuccess',
  warning: 'colorWarning',
  danger: 'colorDanger',
  info: 'colorInfo',
};
const BADGE_COLOR = {
  primary: 'badgeColorPrimary',
  success: 'badgeColorSuccess',
  warning: 'badgeColorWarning',
  danger: 'badgeColorDanger',
  info: 'badgeColorInfo',
};
const el = (tag, cls, children = []) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
};
const icon = (name, cls = '') => el('i', `fe fe-${name} ${cls}`);

// widgetContentUtils.splitIntoSlots
function splitIntoSlots(components) {
  const slots = { header: [], tiles: [], focal: null, body: null, status: null, buttons: [] };
  for (const c of components) {
    if (c.type === 'text') c.variant === 'body' ? (slots.body = c) : slots.header.push(c);
    else if (c.type === 'value' || c.type === 'gauge') slots.tiles.push(c);
    else if (['chart', 'card-list', 'image'].includes(c.type)) slots.focal = c;
    else if (c.type === 'status') slots.status = c;
    else if (c.type === 'button') slots.buttons.push(c);
  }
  return slots;
}

const header = (components) =>
  el(
    'div',
    'header',
    components.map((c) => el('div', c.variant === 'heading' ? 'heading' : 'caption', text(c.text))),
  );

const tiles = (components) =>
  el(
    'div',
    'tilesBox',
    el(
      'div',
      `tiles tilesCount${Math.min(components.length, 6)}`,
      components.map((c) =>
        el('div', 'tile', [
          c.icon ? icon(c.icon, `tileIcon ${COLOR[c.color] || ''}`) : null,
          el('span', `tileValue ${COLOR[c.color] || ''}`, [
            formatNumber(c.value),
            c.unit ? el('span', 'tileUnit', text(c.unit)) : null,
          ]),
          c.label ? el('span', 'tileLabel', text(c.label)) : null,
        ]),
      ),
    ),
  );

// LazyWidgetImage: the frame, then the image the integration serves for the
// key (here the NWS icon render.sh downloaded).
const image = (key, alt) => {
  const img = el('img', 'imageCover');
  img.src = `icons/${key}.png`;
  img.alt = text(alt);
  return el('div', 'imageFrame', img);
};

// WidgetCardList: the list shows the date of an item, else its subtitle; an
// item with a description or links is clickable.
const cardList = (component) =>
  el(
    'div',
    null,
    el(
      'div',
      'cardList',
      component.items.map((item) => {
        const clickable = Boolean(item.description) || (item.links && item.links.length > 0);
        const meta = item.date ? new Date(item.date).toLocaleString(LANG) : text(item.subtitle);
        const node = el('button', `cardListItem ${clickable ? 'clickable' : ''}`, [
          item.image ? image(item.image, item.title) : null,
          el('div', 'cardListText', [
            el('span', 'cardTitle', text(item.title)),
            meta ? el('span', 'cardMeta', meta) : null,
            item.badge
              ? el('span', `wbadge ${BADGE_COLOR[item.badge.color] || ''}`, text(item.badge.text))
              : null,
          ]),
        ]);
        node.type = 'button';
        node.disabled = !clickable;
        return node;
      }),
    ),
  );

const ANNOTATION_COLORS = {
  neutral: '#667081',
  primary: '#467fcf',
  success: '#2e8f5b',
  warning: '#f68f00',
  danger: '#d63939',
  info: '#45aaf2',
};
const annotationLabel = (label, color, textAnchor = 'middle') => ({
  text: label,
  borderColor: color,
  orientation: 'horizontal',
  position: 'top',
  textAnchor,
  style: {
    background: color,
    color: '#fff',
    fontSize: '10px',
    fontWeight: 600,
    padding: { left: 4, right: 4 },
  },
});

function chart(component) {
  const box = el('div', null, [
    component.title ? el('div', 'caption mb-1', text(component.title)) : null,
  ]);
  const target = el('div');
  box.append(target);
  const series = component.series.map((s, i) => ({
    name: text(s.name) || `${i + 1}`,
    data: s.points.map((p) => [new Date(p.t).getTime(), p.v]),
  }));
  let min = Infinity;
  let max = -Infinity;
  series.forEach((s) =>
    s.data.forEach(([t]) => {
      min = Math.min(min, t);
      max = Math.max(max, t);
    }),
  );
  const anchor = (x) => (x > max - (max - min) * 0.08 ? 'end' : 'middle');
  const xaxis = [];
  const points = [];
  for (const a of component.annotations || []) {
    const x = new Date(a.t).getTime();
    const color = ANNOTATION_COLORS[a.color] || ANNOTATION_COLORS.neutral;
    const label = text(a.label);
    if (typeof a.value === 'number') {
      points.push({
        x,
        y: a.value,
        marker: { size: 4, fillColor: '#fff', strokeColor: color, strokeWidth: 2 },
        ...(label ? { label: annotationLabel(label, color, anchor(x)) } : {}),
      });
    } else {
      xaxis.push({
        x,
        borderColor: color,
        strokeDashArray: 0,
        ...(label ? { label: annotationLabel(label, color, anchor(x)) } : {}),
      });
    }
  }
  if (component.now_marker) {
    const now = Date.now();
    const tolerance = Math.max((max - min) * 0.05, 5 * 60 * 1000);
    if (now >= min - tolerance && now <= max + tolerance) {
      const x = Math.min(Math.max(now, min), max);
      xaxis.push({
        x,
        borderColor: ANNOTATION_COLORS.neutral,
        strokeDashArray: 4,
        label: annotationLabel(NOW_LABEL[LANG], ANNOTATION_COLORS.neutral, anchor(x)),
      });
    }
  }
  const yAxisFormatter = (value) => {
    if (value === null || value === undefined || Number.isNaN(value)) return value;
    if (value === 0) return '0';
    const rounded = parseFloat(value.toPrecision(4));
    if (Math.abs(rounded) < 0.001 || Math.abs(rounded) >= 1e9) return rounded.toExponential(2);
    return value.toFixed(2);
  };
  const isBar = component.chart_type === 'bar';
  const options = {
    chart: {
      locales: window.APEX_LOCALES,
      defaultLocale: LANG,
      type: isBar ? 'bar' : 'line',
      fontFamily: 'inherit',
      height: 200,
      parentHeightOffset: 0,
      sparkline: { enabled: false },
      toolbar: { show: false },
      animations: { enabled: false },
      ...(isBar ? { stacked: true, zoom: { enabled: true } } : {}),
    },
    ...(isBar ? { plotOptions: { bar: { columnWidth: '90%' } } } : {}),
    dataLabels: { enabled: false },
    fill: { opacity: 1 },
    ...(isBar ? {} : { stroke: { width: 2, curve: 'stepline' } }),
    series,
    grid: isBar
      ? {
          padding: { top: -20, right: 0, left: -4, bottom: -4 },
          strokeDashArray: 4,
          xaxis: { lines: { show: true } },
        }
      : { strokeDashArray: 4, padding: { left: -4 } },
    xaxis: {
      labels: { padding: 0, datetimeUTC: false },
      tooltip: { enabled: false },
      axisBorder: { show: false },
      type: 'datetime',
    },
    yaxis: { labels: { padding: 4, formatter: yAxisFormatter } },
    colors: ['#316cbe', '#d63031', '#00b894', '#fdcb6e', '#6c5ce7'],
    legend: { show: true, position: 'bottom' },
    annotations: { xaxis, points },
  };
  requestAnimationFrame(() => {
    window.PENDING_CHARTS += 1;
    new ApexCharts(target, options).render().then(() => {
      window.PENDING_CHARTS -= 1;
    });
  });
  return box;
}

// WidgetButtons: a link button shows the domain it opens.
const buttons = (components) =>
  el(
    'div',
    'buttons',
    components.map((c) =>
      el('a', `button ${c.style === 'primary' ? 'buttonPrimary' : ''}`, [
        el('span', 'buttonIcon', icon(c.icon || 'external-link')),
        el('span', 'buttonLabel', text(c.label)),
        c.link ? el('span', 'buttonDomain', `(${new URL(c.link.url).hostname})`) : null,
      ]),
    ),
  );

function card(name) {
  const content = DATA.contents[LANG][name];
  const { icon: cardIcon, label } = DATA.cards[name];
  const slots = splitIntoSlots(content.components);
  return el('div', 'card', [
    el(
      'div',
      'card-header',
      el('h3', 'card-title', [icon(cardIcon || 'grid'), el('span', 'm-1', text(label))]),
    ),
    el(
      'div',
      'card-body',
      el('div', 'slots', [
        slots.header.length ? header(slots.header) : null,
        slots.tiles.length ? tiles(slots.tiles) : null,
        slots.focal && slots.focal.type === 'chart' ? chart(slots.focal) : null,
        slots.focal && slots.focal.type === 'card-list' ? cardList(slots.focal) : null,
        slots.body ? el('p', 'body', text(slots.body.text)) : null,
        slots.buttons.length ? buttons(slots.buttons) : null,
      ]),
    ),
  ]);
}

window.PENDING_CHARTS = 0;
const row = document.getElementById('row');
for (const name of CARDS) {
  row.append(el('div', 'col', card(name)));
}
setTimeout(() => {
  const wait = () => {
    if (window.PENDING_CHARTS === 0) {
      document.body.dataset.ready = '1';
      Date.now = realNow;
    } else setTimeout(wait, 50);
  };
  wait();
}, 100);
