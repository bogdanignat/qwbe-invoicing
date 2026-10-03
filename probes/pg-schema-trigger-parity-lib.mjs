/**
 * Trigger parity against the frozen SQLite capture, not against a hand-written
 * list shipped in the same change.
 *
 * `standalone/parity/sqlite-baseline-triggers.json` was captured from SQLite
 * before any translation existed, so it is the oracle: name, table, timing,
 * event, the `UPDATE OF` column list, whether a `WHEN` predicate existed and
 * whether that predicate used a subquery, and the message the trigger raised.
 *
 * The predicate itself cannot be compared as text — PostgreSQL re-renders an
 * expression (`BETWEEN` expands, casts appear, parentheses move), so a string
 * diff would fail on formatting and say nothing about meaning. What is compared
 * instead is the semantic footprint: the set of column references, function
 * names, string literals and numeric literals the predicate touches. A trigger
 * moved to another column, another table or another threshold changes that set;
 * reformatting does not.
 */

const KEYWORDS = new Set([
  "and", "or", "not", "is", "null", "exists", "select", "from", "where", "distinct", "between",
  "in", "case", "when", "then", "else", "end", "as", "true", "false", "on", "by", "order", "group",
  "having", "limit", "offset", "all", "any", "some", "union", "with",
])

/** The semantic footprint of an SQL predicate: identifiers and literals, as a sorted set. */
export const footprint = (expression) => {
  if (expression === null || expression === undefined) return []
  const literals = []
  const withoutCasts = expression.replace(/::\s*[a-zA-Z_][a-zA-Z0-9_ ]*/gu, "")
  const withoutLiterals = withoutCasts.replace(/'((?:[^']|'')*)'/gu, (_, value) => {
    literals.push(`s:${value.replace(/''/gu, "'")}`)
    return " "
  })
  const words = withoutLiterals.toLowerCase().match(/[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)*|\d+/gu) ?? []
  const kept = words.filter((word) => !KEYWORDS.has(word))
  return [...new Set([...kept, ...literals])].sort()
}

/**
 * The predicate a translated trigger carries, wherever it ended up living.
 *
 * It is read out of `pg_get_triggerdef`, not out of `pg_get_expr(tgqual, …)`:
 * a `WHEN` that mentions both OLD and NEW makes the latter fail with
 * `expression contains variables of more than one relation`.
 */
export const translatedPredicate = (row) => {
  if (row.has_when) {
    const definition = row.definition ?? ""
    const opens = definition.indexOf(" WHEN (")
    const closes = definition.lastIndexOf(") EXECUTE FUNCTION")
    if (opens !== -1 && closes > opens) {
      return { where: "when", expression: definition.slice(opens + " WHEN (".length, closes) }
    }
    return { where: "when", expression: null }
  }
  const body = /\bIF\s+([\s\S]*?)\s+THEN\s+RAISE\b/u.exec(row.action_source ?? "")
  return body === null ? { where: "none", expression: null } : { where: "body", expression: body[1] }
}

/** The message a translated trigger raises, from the trigger argument or the function body. */
export const translatedMessage = (row) => {
  const argument = /EXECUTE FUNCTION qwbe_abort\('((?:[^']|'')*)'\)/u.exec(row.definition ?? "")
  if (argument !== null) return argument[1].replace(/''/gu, "'")
  const inBody = /MESSAGE\s*=\s*'((?:[^']|'')*)'/u.exec(row.action_source ?? "")
  return inBody === null ? null : inBody[1].replace(/''/gu, "'")
}

const eventOf = (row) => (row.on_insert ? "INSERT" : row.on_delete ? "DELETE" : row.on_update ? "UPDATE" : "?")

/**
 * Compares the live triggers with the golden capture and answers one list of
 * differences; an empty list is the only passing result.
 */
export const triggerDifferences = (golden, live) => {
  const differences = []
  const byName = new Map(live.map((row) => [row.name, row]))
  const goldenNames = golden.triggers.map(({ name }) => name).sort()
  const liveNames = [...byName.keys()].sort()
  for (const name of liveNames) if (!goldenNames.includes(name)) differences.push(`${name}: not in the capture`)
  for (const expected of golden.triggers) {
    const row = byName.get(expected.name)
    if (row === undefined) {
      differences.push(`${expected.name}: missing`)
      continue
    }
    const note = (what, want, got) => {
      if (JSON.stringify(want) !== JSON.stringify(got)) {
        differences.push(`${expected.name}.${what}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)
      }
    }
    note("table", expected.table, row.table_name)
    note("timing", expected.timing, row.before ? "BEFORE" : "AFTER")
    note("event", expected.event, eventOf(row))
    note("forEachRow", true, row.for_each_row)
    note("updateOf", expected.updateOf, [...row.update_of])
    const predicate = translatedPredicate(row)
    // A subquery predicate cannot live in WHEN on PostgreSQL, so it must have
    // moved into the function body — and only then.
    note("predicateHome", expected.when === null ? "none" : expected.whenUsesSubquery ? "body" : "when",
      predicate.where)
    note("predicate", footprint(expected.when), footprint(predicate.expression))
    note("message", expected.raiseMessages[0] ?? null, translatedMessage(row))
  }
  return differences
}
