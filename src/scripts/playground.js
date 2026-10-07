// Landing playground — calls the public /api/demo/scan endpoint (real Privacy
// Filter) and renders the pseudonymized output with token highlighting.

const API = 'https://api.cloakpipe.co/api/demo/scan';

const input = document.getElementById('pg-input');
const out = document.getElementById('pg-output');
const meta = document.getElementById('pg-meta');
const btn = document.getElementById('pg-run');

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Wrap pseudonymized tokens (e.g. PERSON_3, EMAIL_4@DOMAIN_1.org) in a green pill.
function highlight(masked) {
  return esc(masked)
    .replace(/\b[A-Z][A-Z0-9]*_\d+@[A-Z][A-Z0-9]*_\d+(?:\.[a-z]+)?\b/g, (m) => `<span class="tok">${m}</span>`)
    .replace(/\b[A-Z][A-Z0-9]*_\d+\b/g, (m) => `<span class="tok">${m}</span>`);
}

function cleanCategory(c) {
  return c.replace(/^Custom\("(.+)"\)$/, '$1');
}

async function run() {
  const text = input.value.trim();
  if (!text) { out.textContent = 'Type or paste some text first.'; return; }
  btn.disabled = true;
  out.textContent = 'Masking…';
  meta.innerHTML = '';
  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (r.status === 429) {
      out.textContent = 'Rate limit reached (30/min). Give it a minute and try again.';
      return;
    }
    if (!r.ok) {
      out.textContent = `Server returned ${r.status}. Try again shortly.`;
      return;
    }
    const d = await r.json();
    out.innerHTML = highlight(d.masked || '');
    const chips = [`${d.entities_detected} entities masked`].concat(
      (d.categories || [])
        .sort((a, b) => b.count - a.count)
        .map((c) => `${cleanCategory(c.category)} · ${c.count}`),
    );
    if (d.truncated) chips.push('truncated to 4000 chars');
    meta.innerHTML = chips.map((c) => `<span class="pg-chip">${esc(c)}</span>`).join('');
  } catch (e) {
    out.textContent = 'Network error — could not reach the API. Try again shortly.';
  } finally {
    btn.disabled = false;
  }
}

btn.addEventListener('click', run);
// run once on load so the output isn't empty
run();
