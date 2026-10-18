import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// Lists a fixture cube, by its repository path (`cubes/invoicing/reporting`), in the
// fixture's root qwbe-package.json the way the real package lists its cubes, and
// creates its directory. The manifest is written on first use.
export const listCube = (root, id) => {
  const path = join(root, "qwbe-package.json")
  const manifest = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : { name: "fixture-pack", kind: "plugin", summary: "Fixture package", cubes: [] }
  manifest.cubes.push(id.replace(/^cubes\//, ""))
  writeFileSync(path, JSON.stringify(manifest))
  mkdirSync(join(root, id), { recursive: true })
}
