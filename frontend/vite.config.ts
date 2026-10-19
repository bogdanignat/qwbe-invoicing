import { fileURLToPath } from "node:url"

import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type ProxyOptions } from "vite"

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url))

/**
 * Where the dev server sends `/api`: the kernel, `QWBE_KERNEL_URL`, by default
 * the one a local `serve` listens on. Only an `http(s)` origin is taken.
 */
const kernelOrigin = (value = process.env.QWBE_KERNEL_URL ?? "http://127.0.0.1:3000"): string => {
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`QWBE_KERNEL_URL must be http(s): ${value}`)
  return url.origin
}

/**
 * The kernel sees the request the browser made. Host and Origin pass through
 * untouched — no `changeOrigin`, no rewritten header — so the kernel's own
 * Host, Origin and CSRF checks judge them against PUBLIC_ORIGIN, which in
 * development is the address this dev server is opened on. No X-Forwarded-*
 * is added either: a proxy in front of Vite keeps the ones it set.
 */
const kernelProxy = (): ProxyOptions => ({ target: kernelOrigin(), changeOrigin: false, xfwd: false, ws: false })

/**
 * PUBLIC_ORIGIN's host, the one name besides localhost the dev server answers
 * to (Vite refuses other Host headers: DNS rebinding).
 */
const publicHosts = (): Array<string> => {
  const origin = process.env.PUBLIC_ORIGIN
  return origin === undefined || origin === "" ? [] : [new URL(origin).hostname]
}

export default defineConfig({
  root: here("."),
  plugins: [
    // First: it writes src/routeTree.gen.ts from src/routes/ before anything is transformed.
    tanstackRouter({
      target: "react",
      routesDirectory: here("src/routes"),
      generatedRouteTree: here("src/routeTree.gen.ts"),
      tmpDir: here(".tanstack/tmp"),
      quoteStyle: "double",
      semicolons: false,
      addExtensions: true,
      // Each screen is its own chunk, loaded when it is first opened.
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  build: {
    outDir: here("dist"),
    emptyOutDir: true,
    assetsDir: "assets",
    // The page is served under `script-src 'self'; style-src 'self'`: nothing is
    // inlined, every script, stylesheet and image is its own hashed file.
    assetsInlineLimit: 0,
  },
  server: {
    // A fixed port: the origin the kernel is configured with must not move.
    port: 5173,
    strictPort: true,
    allowedHosts: publicHosts(),
    proxy: { "^/api(?:/|\\?|$)": kernelProxy() },
  },
})
