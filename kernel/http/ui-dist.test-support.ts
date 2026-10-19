import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

/**
 * A fake Vite build, so the kernel's UI serving is tested without building the
 * frontend: the shape Vite emits (`index.html`, hashed `assets/`, a public file
 * at the root, a `.vite/` manifest that is not shipped), with known bytes.
 */
export const fakeIndex = "<!doctype html><html lang=\"ro\"><head><script type=\"module\" src=\"/assets/index-B1x2c3d4.js\"></script></head><body><div id=\"root\"></div></body></html>\n"
export const fakeScript = "console.log(\"qwbe\")\n"
export const fakeStyle = "body{margin:0}\n"
export const fakeIcon = "<svg xmlns=\"http://www.w3.org/2000/svg\"/>\n"

export const fakeScriptPath = "/assets/index-B1x2c3d4.js"
export const fakeStylePath = "/assets/index-Cc9_x-Yz.css"

/** Under `parent` when given (a fixture's data directory, removed with it), else a fresh temporary directory. */
export const writeFakeUiDist = (files: Readonly<Record<string, string>> = {}, parent?: string): string => {
  const directory = mkdtempSync(join(parent ?? process.env.TMPDIR ?? tmpdir(), "qwbe-ui-dist-"))
  const all: Record<string, string> = {
    "index.html": fakeIndex,
    [fakeScriptPath.slice(1)]: fakeScript,
    [fakeStylePath.slice(1)]: fakeStyle,
    "favicon.svg": fakeIcon,
    ".vite/manifest.json": "{\"secret\":\"not shipped\"}",
    ...files,
  }
  for (const [relative, content] of Object.entries(all)) {
    const path = join(directory, relative)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
  return directory
}
