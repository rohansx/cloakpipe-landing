import { defineConfig } from 'astro/config';

// Static multi-page marketing site (Design V2).
// `format: 'directory'` emits /trust/index.html, served at clean URLs like
// /trust. Legacy /trust.html links are 301'd to the clean path by nginx.
// `inlineStylesheets: 'auto'` inlines small CSS into <head> instead of a
// blocking <link>, dropping FCP/LCP by ~150ms on slow networks.
export default defineConfig({
  site: 'https://cloakpipe.co',
  build: {
    format: 'directory',
    inlineStylesheets: 'always',
  },
  // Docs pages (src/pages/docs/*.md): code blocks carry both themes as CSS
  // variables; Docs.astro picks one from the site's data-theme attribute.
  markdown: {
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
      wrap: false,
    },
  },
});
