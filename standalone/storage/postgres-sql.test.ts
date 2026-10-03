import assert from "node:assert/strict"
import test from "node:test"

import {
  assignExcluded, fold, foldedOrder, fragments, insertStatement, nameKeyset, pairs, placeholders, rowsWanted,
} from "./postgres-sql.ts"
import { documentKeyset, draftKeyset, sourceFilter } from "./postgres-document-query.ts"

// The composition layer, on its own: no database is needed to prove that a
// fragment numbers its own placeholders and binds exactly that many values.

void test("the name keyset folds both operands and ties on a C-collated id", () => {
  const keyset = nameKeyset({ limit: 2, after: { name: "Ălpha", id: "c-2" } }, "legal_name", 2)
  assert.equal(
    keyset.sql,
    " AND (translate(legal_name,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') COLLATE \"C\""
    + " > translate($2,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') COLLATE \"C\""
    + " OR (translate(legal_name,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') COLLATE \"C\""
    + " = translate($3,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') COLLATE \"C\""
    + " AND id COLLATE \"C\" > $4))",
  )
  assert.deepEqual(keyset.values, ["Ălpha", "Ălpha", "c-2"])
  // The bound value is folded too: folding only the column would make the
  // cursor compare case-sensitively against a case-insensitive ordering.
  assert.equal(keyset.sql.includes(fold("$2")), true)
  assert.equal(foldedOrder("description").endsWith(', id COLLATE "C"'), true)
})

void test("the fold alphabet is written out in full, so every ASCII letter folds", () => {
  const expression = fold("x")
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") assert.equal(expression.includes(letter), true)
  // Not a range: `A-Z` would fold three characters and leave twenty-three alone.
  assert.equal(expression.includes("'A-Z'"), false)
})

void test("an absent page or source produces no SQL and consumes no placeholder", () => {
  assert.deepEqual(nameKeyset({ limit: 1 }, "legal_name", 2), { sql: "", values: [] })
  assert.deepEqual(draftKeyset({ limit: 1 }, 5), { sql: "", values: [] })
  assert.deepEqual(documentKeyset({ limit: 1 }, 5), { sql: "", values: [] })
  assert.deepEqual(sourceFilter(undefined, 5), { sql: "", values: [] })
})

void test("fragments number one after another and report where the next index is", () => {
  const source = { app: "crm", kind: "offer", id: "offer-1" }
  const where = fragments(2, [
    (start) => sourceFilter(source, start, "d."),
    (start) => draftKeyset({ limit: 2, after: { issueDate: "2026-09-01", id: "d-1" } }, start),
  ])
  assert.equal(where.sql, " AND d.source_app=$2 AND d.source_kind=$3 AND d.source_id=$4"
    + " AND (issue_date < $5 OR (issue_date = $6 AND id > $7))")
  assert.deepEqual(where.values, ["crm", "offer", "offer-1", "2026-09-01", "2026-09-01", "d-1"])
  // $8 is the limit: startIndex plus however many values were really bound.
  assert.equal(2 + where.values.length, 8)
})

void test("an empty fragment shifts nothing that follows it", () => {
  const where = fragments(2, [
    (start) => sourceFilter(undefined, start),
    (start) => documentKeyset({ limit: 2, after: { issueDate: "2026-09-01", number: 7, id: "i-1" } }, start),
  ])
  assert.equal(where.sql.startsWith(" AND (issue_date < $2"), true)
  assert.equal(where.values.length, 6)
})

void test("placeholders hand out consecutive numbers and count what they used", () => {
  const marks = placeholders(3)
  assert.equal(marks.next(), "$3")
  assert.equal(marks.next(), "$4")
  assert.equal(marks.used(), 2)
})

void test("an insert is built from pairs, and a mismatched list fails loudly", () => {
  const statement = insertStatement("customers", pairs(["id", "legal_name", "sector"], ["c-1", "Client", null]))
  assert.equal(statement.sql, "INSERT INTO customers(id,legal_name,sector) VALUES($1,$2,$3)")
  assert.deepEqual(statement.values, ["c-1", "Client", null])
  assert.throws(
    () => pairs(["id", "legal_name"], ["c-1"]),
    /column\/value count mismatch: 2 columns, 1 values/u,
  )
})

void test("the upsert assignment list names only the columns it refreshes", () => {
  assert.equal(assignExcluded(["legal_name", "sector"]), "legal_name=excluded.legal_name,sector=excluded.sector")
})

void test("a page asks for one row more than the limit, to know there is a next page", () => {
  assert.equal(rowsWanted({ limit: 25 }), 26)
})
