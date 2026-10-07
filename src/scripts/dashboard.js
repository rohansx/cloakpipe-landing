// ============== THEME ==============
const toggle = document.getElementById('theme-toggle');
const root = document.documentElement;
const stored = localStorage.getItem('cp-theme');
if (stored) root.setAttribute('data-theme', stored);
toggle.addEventListener('click', () => {
  const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  localStorage.setItem('cp-theme', next);
});

// ============== LATENCY CHART ==============
function buildLatencyChart() {
  const w = 600;
  const points = 84;
  const pts = [];
  for (let i = 0; i < points; i++) {
    const base = 110 + Math.sin(i * 0.18) * 18 + Math.sin(i * 0.41) * 9;
    const jitter = (Math.random() - 0.5) * 12;
    const y = Math.max(20, Math.min(180, base + jitter));
    const x = (i / (points - 1)) * w;
    pts.push([x, y]);
  }
  let line = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    line += ` Q${px},${py} ${(px + cx) / 2},${(py + cy) / 2}`;
  }
  line += ` T${pts[pts.length - 1][0]},${pts[pts.length - 1][1]}`;
  const area = line + ` L${w},200 L0,200 Z`;
  document.getElementById('latency-line').setAttribute('d', line);
  document.getElementById('latency-area').setAttribute('d', area);
}
buildLatencyChart();

// ============== LIVE FEED ==============
const feed = document.getElementById('feed');
const ENTITIES = [
  'Sarah Chen', 'Amlodipine 10mg', 'jordan.park@acme.io',
  'Acme Holdings', '$24.5M', '+1-415-555-0182',
  '4929-8841-7732', '478-92-1843', 'Northwind Therapeutics',
  'Alex Rivera', 'MRN-8842-19', 'DOB 03/15/1982',
  'Lipitor 20mg', 'm.lopez@gmail.com', '$1,247.66',
  'Tempus Labs', '+44 20 7946 0958', 'IBAN GB29 NWBK'
];
const PROVIDERS = ['openai/gpt-5', 'anthropic/opus-4.5', 'google/gemini-2.5', 'bedrock/titan', 'self-hosted/vllm'];
const TEMPLATES = [
  'Analyze case for [E] regarding [E] with budget [E]',
  'Summarize patient chart: [E] prescribed [E] · contact [E]',
  'Draft NDA between [E] and [E] for deal value [E]',
  'Customer [E] reported fraud on account [E] for [E]',
  'Generate clinical note for [E] (MRN [E]) seen [E]',
  'Process refund for [E] · ref [E] · amount [E]',
  'Review contract from [E] · party [E] · contact [E]',
  'Triage ticket from [E] re: [E] balance [E]'
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function makeRow() {
  const tpl = pick(TEMPLATES);
  const prompt = tpl.replace(/\[E\]/g, () => `<mark>${pick(ENTITIES)}</mark>`);
  const provider = pick(PROVIDERS);
  const ms = Math.floor(18 + Math.random() * 38);
  const cls = Math.random() > 0.92 ? 'warn' : '';
  const t = new Date();
  const time = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;

  const row = document.createElement('div');
  row.className = 'feed-row ' + cls;
  row.innerHTML = `
    <span class="time">${time}</span>
    <span class="prompt">${prompt}</span>
    <span class="provider">${provider}</span>
    <span class="ms">${ms}ms</span>
    <span class="status-dot"></span>
  `;
  return row;
}

for (let i = 0; i < 10; i++) feed.appendChild(makeRow());

function streamRow() {
  feed.insertBefore(makeRow(), feed.firstChild);
  while (feed.children.length > 30) feed.removeChild(feed.lastChild);
  setTimeout(streamRow, 1400 + Math.random() * 1800);
}
setTimeout(streamRow, 1200);

// ============== KPI TICKERS ==============
let req = 142807;
let ent = 418392;
setInterval(() => {
  req += Math.floor(4 + Math.random() * 12);
  ent += Math.floor(12 + Math.random() * 38);
  document.getElementById('kpi-req').textContent = req.toLocaleString();
  document.getElementById('kpi-ent').textContent = ent.toLocaleString();
}, 1800);

// ============== TOGGLES & TABS ==============
document.querySelectorAll('.toggle').forEach(t => t.addEventListener('click', () => t.classList.toggle('on')));
document.querySelectorAll('.panel-tabs, .range').forEach(g => {
  g.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      g.querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
    });
  });
});
