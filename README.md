# cloakpipe-landing

The CloakPipe marketing site and docs ([cloakpipe.co](https://cloakpipe.co)): a static
[Astro](https://astro.build) site, deployed by Vercel on every push to `main`.

```sh
npm ci
npm run dev        # http://localhost:4321
npm run build      # static site in dist/
node scripts/check-links.mjs   # every internal link in dist/ must resolve
```

- Pages: `src/pages/` (docs are Markdown in `src/pages/docs/`, sidebar order in `src/lib/docs.ts`).
- Page bodies: `src/partials/*.html`; shared chrome: `src/components/`, `src/layouts/`.
- Headers, redirects and the Content-Security-Policy: `vercel.json`.

The product itself is open source at [rohansx/cloakpipe](https://github.com/rohansx/cloakpipe).
