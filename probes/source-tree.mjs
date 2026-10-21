import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { pathToFileURL } from "node:url"

const SOURCE_FILE = /\.(?:c|m)?(?:j|t)sx?$/
const TEST_FILE = /\.(?:test|spec|test-support)\.(?:c|m)?(?:j|t)sx?$/
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "build", "coverage", ".git"])

export const toPosix = (path) => path.split(sep).join("/")
export const isTestFile = (path) => TEST_FILE.test(path)

const directoriesBelow = (root) => {
  const found = []
  const visit = (directory) => {
    if (!existsSync(directory) || !lstatSync(directory).isDirectory()) return
    found.push(directory)
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(entry.name)) continue
      visit(join(directory, entry.name))
    }
  }
  visit(root)
  return found
}

// The package is described once, at the repository root, in the crm-pack form:
// `{ name, kind: "plugin", summary, cubes: ["invoicing", "invoicing/payments", ...] }`,
// every path relative to `cubes/`. Every gate reads its units from here, so the
// inventory fails closed: a missing manifest, an empty list, a duplicate, a path
// that escapes `cubes/` or crosses a symlink, and a cube on disk that the list
// leaves out are all refused before any gate measures anything.
export const PACKAGE_MANIFEST = "qwbe-package.json"
export const CUBES_DIRECTORY = "cubes"
const CUBE_PATH = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/

// Thrown only for a manifest or cube tree that the inventory refuses, so a caller can
// tell "fix qwbe-package.json" apart from a bug, which keeps its own type and stack.
export class PackageManifestError extends Error {}

const realEntry = (path, isKind) => {
  const stat = lstatSync(path, { throwIfNoEntry: false })
  return stat !== undefined && !stat.isSymbolicLink() && isKind(stat)
}
const isRealDirectory = (root, segments) => segments.every((_, index) =>
  realEntry(join(root, ...segments.slice(0, index + 1)), (stat) => stat.isDirectory()))

// A directory is a cube when its index.ts exports `cube`, the definition the package
// gate then holds the manifest to. The module is loaded rather than read as text, so
// every form counts the same: `export const cube`, `export { cube } from`, `export *`.
export const loadCube = async (directory) => {
  const entry = join(directory, "index.ts")
  if (!realEntry(entry, (stat) => stat.isFile())) return undefined
  return (await import(pathToFileURL(entry).href)).cube
}

export const readPackageManifest = (root) => {
  const path = join(root, PACKAGE_MANIFEST)
  if (!realEntry(path, (stat) => stat.isFile())) throw new PackageManifestError(`${PACKAGE_MANIFEST} must be a regular file at the repository root`)
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    throw new PackageManifestError(`${PACKAGE_MANIFEST} is not valid JSON: ${error.message}`)
  }
}

export const discoverCubeUnits = async (root) => {
  const declared = readPackageManifest(root)?.cubes
  if (!Array.isArray(declared) || declared.length === 0) throw new PackageManifestError(`${PACKAGE_MANIFEST} must list at least one cube`)

  const problems = []
  const listed = new Set()
  for (const path of declared) {
    if (typeof path !== "string" || !CUBE_PATH.test(path)) problems.push(`invalid cube path ${JSON.stringify(path)}`)
    else if (listed.has(path)) problems.push(`duplicate cube ${path}`)
    else if (!isRealDirectory(root, [CUBES_DIRECTORY, ...path.split("/")])) problems.push(`${CUBES_DIRECTORY}/${path} is not a real directory`)
    if (typeof path === "string") listed.add(path)
  }
  const cubesRoot = join(root, CUBES_DIRECTORY)
  for (const directory of directoriesBelow(cubesRoot)) {
    if (listed.has(toPosix(relative(cubesRoot, directory))) || await loadCube(directory) === undefined) continue
    problems.push(`${toPosix(relative(root, directory))} declares a cube but is not listed`)
  }
  if (problems.length > 0) throw new PackageManifestError(`${PACKAGE_MANIFEST}: ${problems.join("; ")}`)

  return declared
    .map((path) => ({ id: `${CUBES_DIRECTORY}/${path}`, directory: join(cubesRoot, ...path.split("/")) }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

export const sourceFilesOwnedBy = (unit, allUnits, excludedDirectories = new Set()) => {
  const childRoots = new Set(
    allUnits
      .filter((candidate) => candidate.directory !== unit.directory && candidate.directory.startsWith(`${unit.directory}${sep}`))
      .map((candidate) => candidate.directory),
  )
  const files = []

  const visit = (directory) => {
    if (childRoots.has(directory) || excludedDirectories.has(directory)) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name.startsWith(".")) continue
      const fullPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) visit(fullPath)
      } else if (entry.isFile() && SOURCE_FILE.test(entry.name)) {
        files.push(fullPath)
      }
    }
  }

  visit(unit.directory)
  return files.sort()
}
