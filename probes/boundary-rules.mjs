const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const ruleName = (value) => value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "")

const ownerSelector = (unit, units) => {
  const descendants = units.filter(
    (candidate) => candidate.id !== unit.id && candidate.id.startsWith(`${unit.id}/`),
  )
  return {
    path: `^${escapePattern(unit.id)}/`,
    ...(descendants.length > 0
      ? { pathNot: descendants.map((candidate) => `^${escapePattern(candidate.id)}/`) }
      : {}),
  }
}

// The isolation unit is a top-level cube together with its child cubes, exactly as the
// mother's `no-cube-to-cube` rule captures only the first path segment under `cubes/`
// (QWBE `core/.dependency-cruiser.cjs`; its example plugin has `booktags/bookmarks`
// importing `../events.ts` from the parent). Parent and children share code freely;
// two different top-level cubes never import each other.
const treeRoot = (unit, units) => units
  .filter((candidate) => candidate.id === unit.id || unit.id.startsWith(`${candidate.id}/`))
  .sort((left, right) => left.id.length - right.id.length)[0]

export const cubeIsolationRules = (units) => units.flatMap((source) =>
  units
    .filter((target) => target.id !== source.id && treeRoot(target, units).id !== treeRoot(source, units).id)
    .map((target) => ({
      name: `no-cube-import-${ruleName(source.id)}-to-${ruleName(target.id)}`,
      severity: "error",
      from: ownerSelector(source, units),
      to: ownerSelector(target, units),
    })),
)
