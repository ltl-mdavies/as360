import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'https://f08446049i.execute-api.us-east-1.amazonaws.com',
        changeOrigin: true,
      },
    },
  },
})
