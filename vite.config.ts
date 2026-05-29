import { defineConfig } from 'vite'

// Multi-page static site: landing + detail pages + dashboard demo.
export default defineConfig({
  appType: 'mpa',
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        trust: 'trust.html',
        platform: 'platform.html',
        integrations: 'integrations.html',
        pricing: 'pricing.html',
        dashboard: 'dashboard.html',
      },
    },
  },
})
