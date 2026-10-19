import assert from "node:assert/strict"
import test from "node:test"

import { freshTyped, lookupTarget, reduceTyped, typedForScope, type TypedAction, type TypedLookup } from "./company-lookup-typed.ts"
import { lookupOutcome } from "./company-lookup-query.ts"
import type { CompanyProposal } from "./company-lookup-model.ts"

const run = (scope: string, actions: ReadonlyArray<TypedAction>, from: TypedLookup = freshTyped(scope)): TypedLookup =>
  actions.reduce((state, action) => reduceTyped(state, scope, action), from)

const proposal: CompanyProposal = { name: "Exemplu SRL", cui: "13548146", vatRegistered: true, deregistered: false, address: {} }
const found = { data: proposal, isPending: false, error: null }

void test("pick looks the suggestion up at once, without waiting for the typed CUI to settle", () => {
  const typed = run("new:company", [{ kind: "type-name", value: "Exemplu" }, { kind: "pick", cui: "13548146" }])
  assert.equal(lookupTarget(typed, undefined), "13548146", "nothing settled yet, the pick is the target")
  assert.equal(typed.name, "", "picking closes the suggestions")
  assert.equal(lookupTarget(run("s", [{ kind: "type-cui", value: "14399840" }]), "14399840"), "14399840")
  assert.equal(lookupTarget(run("s", [{ kind: "type-cui", value: "1439" }]), undefined), undefined, "typed but not settled: nothing")
})

void test("pick → applied → typeCui: the card hides once copied in and comes back for a newly typed CUI", () => {
  const picked = run("s", [{ kind: "pick", cui: "13548146" }])
  assert.deepEqual(lookupOutcome(lookupTarget(picked, undefined), found, picked.applied), { kind: "found", proposal })
  const applied = run("s", [{ kind: "applied", cui: "13548146" }], picked)
  assert.deepEqual(lookupOutcome(lookupTarget(applied, undefined), found, applied.applied), { kind: "applied" })
  const retyped = run("s", [{ kind: "type-cui", value: "RO13548146" }], applied)
  assert.deepEqual([retyped.picked, retyped.applied], [undefined, undefined], "typing drops the pick and the applied mark")
  assert.deepEqual(lookupOutcome(lookupTarget(retyped, "13548146"), found, retyped.applied), { kind: "found", proposal })
})

void test("another scope (customer or party type) drops everything typed, in the same render and on the next action", () => {
  const typed = run("c-1:company", [{ kind: "type-cui", value: "13548146" }, { kind: "type-name", value: "Exemplu" }, { kind: "pick", cui: "14399840" }])
  assert.deepEqual(typedForScope(typed, "c-2:company"), freshTyped("c-2:company"))
  assert.deepEqual(typedForScope(typed, "c-1:individual"), freshTyped("c-1:individual"))
  assert.equal(typedForScope(typed, "c-1:company"), typed)
  assert.deepEqual(reduceTyped(typed, "c-2:company", { kind: "type-name", value: "Alt" }), { ...freshTyped("c-2:company"), name: "Alt" })
})

void test("closing the suggestions empties only the name, and is a no-op when already closed", () => {
  const typed = run("s", [{ kind: "type-cui", value: "13548146" }, { kind: "type-name", value: "Exemplu" }, { kind: "close-suggestions" }])
  assert.deepEqual([typed.cui, typed.name], ["13548146", ""])
  assert.equal(reduceTyped(typed, "s", { kind: "close-suggestions" }), typed)
})
