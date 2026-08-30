import { readFileSync } from "node:fs"
import { relative } from "node:path"

import ts from "typescript"

import { discoverCubeUnits, isTestFile, sourceFilesOwnedBy, toPosix } from "./source-tree.mjs"

export const stripCommentsAndBlankLines = (source) => {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source)
  let result = ""
  let cursor = 0
  let token = scanner.scan()

  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) {
      result += source.slice(cursor, scanner.getTokenPos())
      cursor = scanner.getTextPos()
    }
    token = scanner.scan()
  }
  result += source.slice(cursor)

  return result.split("\n").filter((line) => line.trim() !== "").join("\n")
}

export const measureFile = (path) => {
  const raw = readFileSync(path, "utf8")
  return { raw: raw.length, code: stripCommentsAndBlankLines(raw).length }
}

export const inspectSizes = (root, cubeRoots) => {
  const units = discoverCubeUnits(root, cubeRoots)
  const files = []
  const measuredUnits = units.map((unit) => {
    const owned = sourceFilesOwnedBy(unit, units).filter((path) => !isTestFile(path))
    const measured = owned.map((path) => ({ path: toPosix(relative(root, path)), ...measureFile(path) }))
    files.push(...measured)
    return {
      id: unit.id,
      files: measured.length,
      code: measured.reduce((total, file) => total + file.code, 0),
      raw: measured.reduce((total, file) => total + file.raw, 0),
    }
  })
  return { files: files.sort((left, right) => left.path.localeCompare(right.path)), units: measuredUnits }
}

export const sizeViolations = (measurement, caps) => ({
  files: measurement.files.filter((file) => file.code > caps.maxCharsPerFile),
  units: measurement.units.filter(
    (unit) => unit.code > caps.maxCharsPerUnit || unit.files > caps.maxFilesPerUnit,
  ),
})
