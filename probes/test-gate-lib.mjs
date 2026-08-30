import { discoverCubeUnits, isTestFile, sourceFilesOwnedBy } from "./source-tree.mjs"

export const inspectTestCoverage = (root, cubeRoots) => {
  const units = discoverCubeUnits(root, cubeRoots)
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

export const untestedUnits = (root, cubeRoots) =>
  inspectTestCoverage(root, cubeRoots).filter((unit) => unit.sourceCount > 0 && unit.testCount === 0)
