// Client behaviour for the shared marketing chrome: theme toggle, mobile
// drawer, and reveal-on-scroll. The nav/footer markup itself is rendered
// statically by Astro (Nav.astro / Footer.astro); this only wires events.
// Theme is applied pre-paint by an inline script in the layout <head>.

function wireTheme() {
  const toggle = document.getElementById('theme-toggle');
  const root = document.documentElement;
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('cp-theme', next);
  });
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
  // Reveal elements that are *already in the viewport* immediately, otherwise
  // hand them to the IntersectionObserver. This avoids a flash of unstyled
  // content above the fold while still animating off-screen reveals.
  const els = document.querySelectorAll('.reveal');
  const vh = window.innerHeight;
  const above = [];
  const below = [];
  els.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.top < vh - 40) above.push(el);
    else below.push(el);
  });
  above.forEach((el) => el.classList.add('in'));
  if (!below.length) return;
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
  below.forEach((el) => io.observe(el));
}

const schedule = window.requestIdleCallback || ((cb) => setTimeout(cb, 1));
schedule(() => {
  wireTheme();
  wireMenu();
  wireReveal();
});
