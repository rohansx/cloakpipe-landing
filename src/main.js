// Home-only behaviour: the animated hero bar chart + live "masked" counter.
// Theme toggle, reveal-on-scroll, nav and footer live in chrome.js (shared).

function buildHeroChart() {
  const svg = document.getElementById('hero-chart');
  if (!svg) return;
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

  const spikeIdx = new Set();
  for (let i = 0; i < 6; i++) spikeIdx.add(Math.floor(15 + rand() * (N - 30)));
  const heroSpike = Math.floor(N * 0.62);

  let out = '';
  for (let i = 0; i < N; i++) {
    const x = i * (barW + gap);
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
    const color = cls === 'normal' ? 'var(--text)' : 'var(--danger)';
    const opacity = cls === 'hero-spike' ? 1 : cls === 'spike' ? 0.85 : 0.55;
    out += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${h.toFixed(2)}" fill="${color}" opacity="${opacity}"/>`;
  }

  out += `<line x1="0" y1="${H - 1}" x2="${W}" y2="${H - 1}" stroke="var(--accent)" stroke-width="2"/>`;
  out += `<text x="12" y="${H - 8}" font-family="JetBrains Mono" font-size="10" fill="var(--accent)" letter-spacing="1">TRUST LAYER · NONE LEAKED</text>`;
  svg.innerHTML = out;
}
buildHeroChart();

// live "masked" counter
let masked = 418392;
setInterval(() => {
  masked += Math.floor(8 + Math.random() * 24);
  const el = document.getElementById('masked-count');
  if (el) el.textContent = masked.toLocaleString();
}, 1400);
