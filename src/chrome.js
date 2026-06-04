// Shared site chrome — nav (with mobile drawer), footer, theme toggle, reveal.
// Injected into <div id="site-nav"> and <div id="site-footer"> on every page so
// the navigation stays consistent and every link resolves to a real target.

const APP = 'https://app.cloakpipe.co';
const LOGIN = `${APP}/login`;
const SIGNUP = `${APP}/signup`;
const GH = 'https://github.com/rohansx/cloakpipe';
const GH_MCP = 'https://github.com/rohansx/cloakpipe-mcp';
const CONTACT = 'mailto:hello@rohan.sh';

const NAV = [
  { label: 'Home', href: '/index.html', match: ['/', '/index.html'] },
  { label: 'Trust layer', href: '/trust.html', match: ['/trust.html'] },
  { label: 'Platform', href: '/platform.html', match: ['/platform.html'] },
  { label: 'Integrations', href: '/integrations.html', match: ['/integrations.html'] },
  { label: 'Docs', href: '/docs.html', match: ['/docs.html', '/docs'] },
  { label: 'Pricing', href: '/pricing.html', match: ['/pricing.html'] },
  { label: 'Playground', href: '/playground.html', match: ['/playground.html'] },
  { label: 'Demo', href: '/dashboard.html', match: ['/dashboard.html'] },
];

const BRAND_MARK = `
  <svg class="brand-mark" viewBox="0 0 22 22" fill="none">
    <path d="M2 20 L8 4 L10 4 L4 20 Z" fill="currentColor"/>
    <path d="M10 20 L16 4 L18 4 L12 20 Z" fill="currentColor"/>
    <rect x="18" y="3" width="2" height="3" fill="#00FF66"/>
    <rect x="18" y="7" width="2" height="3" fill="#00E0FF"/>
  </svg>`;

const TICK = `<span class="nav-tick"><svg viewBox="0 0 10 10" fill="none"><path d="M2 8 L8 2" stroke="currentColor" stroke-width="1"/></svg></span>`;

const SUN = `<svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2 M12 20v2 M2 12h2 M20 12h2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4"/></svg>`;
const MOON = `<svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 14c-1 4-5 7-9 7-5 0-9-4-9-9 0-4 3-8 7-9-2 4 0 9 4 10 3 1 6 0 7-0z"/></svg>`;
const GITHUB = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.7.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.4-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17 4.6 18 4.9 18 4.9c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A11.5 11.5 0 0 0 23.5 12C23.5 5.7 18.3.5 12 .5z"/></svg>`;

function currentPath() {
  let p = window.location.pathname;
  if (p.endsWith('/')) p += 'index.html';
  return p;
}

function isActive(item, path) {
  return item.match.some((m) => (m === '/' ? path === '/index.html' : path.endsWith(m)));
}

function renderNav() {
  const path = currentPath();
  const links = NAV.map(
    (n) => `<a class="${isActive(n, path) ? 'active' : ''}" href="${n.href}">${n.label}</a>`,
  );
  const desktopLinks = links.join(TICK);
  const drawerLinks = links.join('');

  return `
  <div class="notice">
    <span class="dot"></span>
    v1.4 release · OpenAI Privacy Filter now supported
    <span class="pipe">·</span>
    <a href="${GH}/releases">Read the changelog →</a>
  </div>

  <nav class="nav">
    <a class="brand" href="/index.html">${BRAND_MARK} CloakPipe</a>
    <div class="nav-links">${desktopLinks}</div>
    <div class="nav-right">
      <a class="nav-gh" href="${GH}" target="_blank" rel="noopener" aria-label="CloakPipe on GitHub" title="Star CloakPipe on GitHub">${GITHUB}</a>
      <button class="theme-toggle" id="theme-toggle" aria-label="Toggle theme">${SUN}${MOON}</button>
      <a class="btn btn-cta nav-desk-cta" href="${SIGNUP}"><span class="corner"></span>Try for free <span class="arr">→</span></a>
      <a class="btn nav-desk-cta" href="${LOGIN}">Log in <span class="arr">→</span></a>
      <button class="hamburger" id="hamburger" aria-label="Open menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
    </div>
  </nav>

  <div class="nav-scrim" id="nav-scrim"></div>
  <div class="nav-drawer" id="nav-drawer">
    <div class="nav-drawer-links">${drawerLinks}</div>
    <div class="nav-drawer-cta">
      <a class="btn btn-cta" href="${SIGNUP}"><span class="corner"></span>Try for free <span class="arr">→</span></a>
      <a class="btn" href="${LOGIN}">Log in <span class="arr">→</span></a>
    </div>
  </div>`;
}

function renderFooter() {
  return `
  <footer>
    <div class="wrap">
      <div class="foot-grid">
        <div>
          <div class="foot-brand-row">${BRAND_MARK} CloakPipe</div>
          <p>The trust layer between your application and AI. Rust-native, open source under MIT, managed cloud and enterprise platform from the team.</p>
        </div>
        <div class="foot-col">
          <h4>Product</h4>
          <a href="/trust.html">Trust layer</a>
          <a href="/platform.html">Platform</a>
          <a href="/integrations.html">Integrations</a>
          <a href="/pricing.html">Pricing</a>
          <a href="/playground.html">Playground</a>
          <a href="/dashboard.html">Live demo</a>
        </div>
        <div class="foot-col">
          <h4>Developers</h4>
          <a href="/docs.html">Documentation</a>
          <a href="${GH}">GitHub repo</a>
          <a href="${GH}/releases">Changelog</a>
          <a href="${GH_MCP}">MCP reference</a>
        </div>
        <div class="foot-col">
          <h4>Company</h4>
          <a href="/index.html">Overview</a>
          <a href="/trust.html">Security</a>
          <a href="/platform.html">Compliance</a>
          <a href="${CONTACT}">Contact</a>
        </div>
      </div>
      <div class="foot-bottom">
        <span>© 2026 · CLOAKPIPE · MIT OPEN-SOURCE CORE</span>
        <span class="right">
          <span class="v2">DESIGN V2</span>
          <span>CLOAKPIPE.CO</span>
        </span>
      </div>
    </div>
  </footer>`;
}

function wireTheme() {
  const toggle = document.getElementById('theme-toggle');
  const rootEl = document.documentElement;
  const stored = localStorage.getItem('cp-theme');
  if (stored) rootEl.setAttribute('data-theme', stored);
  if (toggle) {
    toggle.addEventListener('click', () => {
      const next = rootEl.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      rootEl.setAttribute('data-theme', next);
      localStorage.setItem('cp-theme', next);
    });
  }
}

function wireMenu() {
  const burger = document.getElementById('hamburger');
  const drawer = document.getElementById('nav-drawer');
  const scrim = document.getElementById('nav-scrim');
  if (!burger || !drawer || !scrim) return;
  const close = () => {
    drawer.classList.remove('open');
    scrim.classList.remove('open');
    burger.classList.remove('open');
    burger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  };
  const open = () => {
    drawer.classList.add('open');
    scrim.classList.add('open');
    burger.classList.add('open');
    burger.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  };
  burger.addEventListener('click', () =>
    drawer.classList.contains('open') ? close() : open(),
  );
  scrim.addEventListener('click', close);
  drawer.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));
  window.addEventListener('keydown', (e) => e.key === 'Escape' && close());
}

function wireReveal() {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
  );
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
}

function mount() {
  const navHost = document.getElementById('site-nav');
  const footHost = document.getElementById('site-footer');
  if (navHost) navHost.innerHTML = renderNav();
  if (footHost) footHost.innerHTML = renderFooter();
  wireTheme();
  wireMenu();
  wireReveal();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
