import { resolve } from "node:path"
import type { NextConfig } from "next"

const repositoryRoot = resolve(import.meta.dirname, "..")

const configuration: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: repositoryRoot,
  turbopack: { root: repositoryRoot },
  poweredByHeader: false,
  devIndicators: false,
}

export default configuration
