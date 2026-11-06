// Hairline figures (https://hairline.lucasmarkes.com) on the home page.
// Each slot is a <div data-hairline="name" aria-label="…">. The library is
// fetched only when the first slot comes near the viewport, and only the
// figures named here are bundled.

async function load() {
  const { relay, lockers, vault, terminal } = await import('@lucasmarkes/hairline');
  return { relay, lockers, vault, terminal };
}

function wire() {
  const slots = document.querySelectorAll('[data-hairline]');
  if (!slots.length) return;
  let figures = null;
  const io = new IntersectionObserver(async (entries) => {
    const near = entries.filter((e) => e.isIntersecting).map((e) => e.target);
    if (!near.length) return;
    near.forEach((el) => io.unobserve(el));
    try {
      figures ??= load();
      const lib = await figures;
      for (const el of near) {
        const make = lib[el.dataset.hairline];
        if (!make) continue;
        make(el, {
          intensity: Number(el.dataset.intensity ?? 0.55),
          play: el.hasAttribute('data-play'),
          label: el.getAttribute('aria-label') ?? undefined,
        });
      }
    } catch (err) {
      // A figure is decoration: the page reads the same without it.
      console.warn('hairline figures did not load', err);
    }
  }, { rootMargin: '240px 0px' });
  slots.forEach((el) => io.observe(el));
}

wire();
