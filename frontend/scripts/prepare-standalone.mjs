import { cpSync } from "node:fs"
import { fileURLToPath, URL } from "node:url"

// Next traces server dependencies but deliberately leaves static assets outside
// the standalone output. Keep local start identical to the container's layout.
const source = fileURLToPath(new URL("../.next/static", import.meta.url))
const target = fileURLToPath(new URL("../.next/standalone/frontend/.next/static", import.meta.url))
cpSync(source, target, { recursive: true })
