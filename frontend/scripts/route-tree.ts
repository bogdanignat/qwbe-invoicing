/**
 * Checks that the committed `src/routeTree.gen.ts` is the tree `src/routes/`
 * generates, before the typecheck reads it.
 *
 * The tree is written by the router plugin when Vite resolves its config — the
 * same step `vite build` and `vite` start with — so resolving the config here
 * generates it exactly as a build would. The generator is deterministic and
 * rewrites the file only when its content differs: a changed file means the
 * committed one was stale. It stays regenerated on disk, ready to commit, and
 * the check fails so a stale tree never passes the gate.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { resolveConfig } from "vite"

const tree = fileURLToPath(new URL("../src/routeTree.gen.ts", import.meta.url))
const read = (): string => {
  try {
    return readFileSync(tree, "utf8")
  } catch {
    return ""
  }
}

const committed = read()
await resolveConfig({ configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)) }, "build", "production")
if (read() !== committed) {
  console.error("src/routeTree.gen.ts did not match src/routes/: it was regenerated, commit it.")
  process.exitCode = 1
} else {
  console.log("src/routeTree.gen.ts matches src/routes/.")
}
