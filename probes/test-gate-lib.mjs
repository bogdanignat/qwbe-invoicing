import { discoverCubeUnits, isTestFile, sourceFilesOwnedBy } from "./source-tree.mjs"

export const inspectTestCoverage = async (root) => {
  const units = await discoverCubeUnits(root)
  return units.map((unit) => {
    const files = sourceFilesOwnedBy(unit, units)
    const tests = files.filter(isTestFile)
    return {
      id: unit.id,
      sourceCount: files.length - tests.length,
      testCount: tests.length,
    }
  })
}

export const untestedUnits = async (root) =>
  (await inspectTestCoverage(root)).filter((unit) => unit.sourceCount > 0 && unit.testCount === 0)
