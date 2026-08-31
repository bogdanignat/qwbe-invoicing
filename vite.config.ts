import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const repositoryRoot = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig({
  root: resolve(repositoryRoot, "web"),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(repositoryRoot, "standalone/ui-dist"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        codeSplitting: false,
        entryFileNames: "assets/app.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: (asset) => asset.names.some((name) => name.endsWith(".css"))
          ? "assets/app.css"
          : "assets/[name][extname]",
      },
    },
  },
})
