import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("react") || id.includes("react-dom") || id.includes("react-router-dom")) {
            return "vendor-react";
          }
          if (id.includes("@aws-sdk") || id.includes("@smithy")) {
            return "vendor-aws";
          }
          if (id.includes("pdfjs-dist")) {
            return "vendor-pdf";
          }
          if (id.includes("lucide-react")) {
            return "vendor-icons";
          }
          return "vendor";
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'https://f08446049i.execute-api.us-east-1.amazonaws.com',
        changeOrigin: true,
      },
    },
  },
})
