// ============== THEME TOGGLE ==============
const toggle = document.getElementById('theme-toggle');
const root = document.documentElement;
const stored = localStorage.getItem('cp-theme');
if (stored) root.setAttribute('data-theme', stored);
toggle.addEventListener('click', () => {
  const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  localStorage.setItem('cp-theme', next);
});

// ============== REVEAL OBSERVER ==============
const io = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

// ============== HERO CHART ==============
function buildHeroChart() {
  const svg = document.getElementById('hero-chart');
  const W = 800, H = 320;
  const N = 140;
  const gap = 2;
  const barW = (W - (N - 1) * gap) / N;

  // pseudo-random but stable seed
  let seed = 1337;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  // shapes: low baseline that rises slightly over time, with one prominent red spike
  // and a handful of tall sensitive-data bars sprinkled
  const spikeIdx = new Set();
  // a few random high-sensitivity spikes
  for (let i = 0; i < 6; i++) spikeIdx.add(Math.floor(15 + rand() * (N - 30)));
  // one big spotlight spike near right side
  const heroSpike = Math.floor(N * 0.62);

  let out = '';
  for (let i = 0; i < N; i++) {
    const x = i * (barW + gap);
    // baseline rises gently 8 → 80
    const ramp = 8 + (i / N) * 72;
    let h;
    let cls = 'normal';
    if (i === heroSpike) {
      h = 240;
      cls = 'hero-spike';
    } else if (spikeIdx.has(i)) {
      h = 120 + rand() * 80;
      cls = 'spike';
    } else {
      h = ramp + rand() * 36 - 8;
    }
    h = Math.max(2, Math.min(H - 4, h));
    const y = H - h;
    const color = cls === 'hero-spike' ? 'var(--danger)' :
                  cls === 'spike'      ? 'var(--danger)' :
                  'var(--text)';
    const opacity = cls === 'hero-spike' ? 1 :
                    cls === 'spike'      ? 0.85 :
                    0.55;
    out += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${h.toFixed(2)}" fill="${color}" opacity="${opacity}"/>`;
  }

  // baseline horizontal indicator (the trust layer)
  out += `<line x1="0" y1="${H - 1}" x2="${W}" y2="${H - 1}" stroke="var(--accent)" stroke-width="2"/>`;

  // a faint "TRUST LAYER" label on the baseline
  out += `<text x="12" y="${H - 8}" font-family="JetBrains Mono" font-size="10" fill="var(--accent)" letter-spacing="1">TRUST LAYER · NONE LEAKED</text>`;

  svg.innerHTML = out;
}
buildHeroChart();

// ============== HERO MASKED COUNTER ==============
let masked = 418392;
setInterval(() => {
  masked += Math.floor(8 + Math.random() * 24);
  const el = document.getElementById('masked-count');
  if (el) el.textContent = masked.toLocaleString();
}, 1400);
