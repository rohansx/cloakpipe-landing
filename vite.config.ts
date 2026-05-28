import { defineConfig } from 'vite'

// Multi-page static site: landing (index) + dashboard preview.
export default defineConfig({
  appType: 'mpa',
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        dashboard: 'dashboard.html',
      },
    },
  },
})
