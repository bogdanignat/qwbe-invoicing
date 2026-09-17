import { readFileSync } from "node:fs"
import { relative } from "node:path"

import ts from "typescript"

import { discoverCubeUnits, isTestFile, sourceFilesOwnedBy, toPosix } from "./source-tree.mjs"

/**
 * The comment ranges of a file, taken from the parser rather than a bare
 * scanner.
 *
 * A standalone scanner cannot lex a template literal on its own: after the
 * first `${...}` it needs to be told to re-scan the closing brace as a template
 * continuation, and without that it reads the rest of the template as ordinary
 * code. Both errors then follow — a `//` inside the template tail is counted as
 * a comment and dropped, and the real comments after it are no longer
 * recognised and are counted as code. The parser resolves the same ambiguity
 * with the grammar, so every comment here is one the compiler also sees.
 */
const commentRanges = (source, fileName) => {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const found = new Map()
  const visit = (node) => {
    for (const range of ts.getLeadingCommentRanges(source, node.getFullStart()) ?? []) {
      found.set(`${range.pos}:${range.end}`, range)
    }
    for (const child of node.getChildren(file)) visit(child)
  }
  visit(file)
  return [...found.values()].sort((left, right) => left.pos - right.pos)
}

export const stripCommentsAndBlankLines = (source, fileName = "source.ts") => {
  let result = ""
  let cursor = 0
  for (const range of commentRanges(source, fileName)) {
    // A doc comment is the leading trivia of several nested nodes at once, and
    // JSDoc is reported both as trivia and as a node, so a range already
    // consumed is skipped rather than counted twice.
    if (range.pos < cursor) continue
    result += source.slice(cursor, range.pos)
    cursor = range.end
  }
  result += source.slice(cursor)

  return result.split("\n").filter((line) => line.trim() !== "").join("\n")
}

export const measureFile = (path) => {
  const raw = readFileSync(path, "utf8")
  return { raw: raw.length, code: stripCommentsAndBlankLines(raw, path).length }
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
