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

export const cubeIsolationRules = (units) => units.flatMap((source) =>
  units
    .filter((target) => target.id !== source.id)
    .map((target) => ({
      name: `no-cube-import-${ruleName(source.id)}-to-${ruleName(target.id)}`,
      severity: "error",
      from: ownerSelector(source, units),
      to: ownerSelector(target, units),
    })),
)
