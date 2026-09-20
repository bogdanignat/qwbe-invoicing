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
// importing `../events.ts` from the parent). Two different top-level cubes never
// import each other; inside one tree `cubeTreeRules` below narrows what may cross.
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

// Inside one tree a child may use the kernel of any ancestor, but every other
// unit — a child seen from its parent, a sibling, a cousin — is entered only
// through its exact `index.ts`. That keeps each child's interior private to it
// while the kernel it grew out of stays shared. No edge is exempt: a parent that
// needs a child's type takes it from the child's index, and the child owns its port.
const exactPath = (path) => `^${escapePattern(path)}$`
const isAncestor = (candidate, unit) => unit.id.startsWith(`${candidate.id}/`)

const throughIndex = (target, units) => {
  const owner = ownerSelector(target, units)
  return { path: owner.path, pathNot: [...(owner.pathNot ?? []), exactPath(`${target.id}/index.ts`)] }
}

export const cubeTreeRules = (units) => units.flatMap((source) =>
  units
    .filter((target) => target.id !== source.id && !isAncestor(target, source)
      && treeRoot(target, units).id === treeRoot(source, units).id)
    .map((target) => ({
      name: `cube-tree-${ruleName(source.id)}-to-${ruleName(target.id)}-only-through-index`,
      severity: "error",
      from: ownerSelector(source, units),
      to: throughIndex(target, units),
    })),
)
