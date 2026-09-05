import { existsSync, lstatSync, readdirSync } from "node:fs"
import { join, relative, sep } from "node:path"

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

export const discoverCubeUnits = (root, cubeRoots) => {
  const units = cubeRoots
    .flatMap((cubeRoot) => directoriesBelow(join(root, cubeRoot)))
    .filter((directory) => existsSync(join(directory, "qwbe-package.json")))
    .map((directory) => ({
      id: toPosix(relative(root, directory)),
      directory,
    }))

  return units.sort((left, right) => left.id.localeCompare(right.id))
}

export const sourceFilesOwnedBy = (unit, allUnits) => {
  const childRoots = new Set(
    allUnits
      .filter((candidate) => candidate.directory !== unit.directory && candidate.directory.startsWith(`${unit.directory}${sep}`))
      .map((candidate) => candidate.directory),
  )
  const files = []

  const visit = (directory) => {
    if (childRoots.has(directory)) return
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
