import assert from "node:assert/strict"
import test from "node:test"
import { Effect } from "effect"

import { createInvoicingService } from "../../application/invoicing.ts"
import { brandingNormalizer, contextProvider, emptyState, fixedClock, identity, memoryStore, sequentialIds } from "../../application/memory-store.test-support.ts"
import { DomainConflict, PermissionDenied } from "../../contracts/failures.ts"

void test("document series authorize, isolate organizations and roll back with their audit", async () => {
  const state = emptyState()
  const store = memoryStore(state)
  const ids = sequentialIds()
  const dependencies = (organizationId: string, permissions = identity.permissions) => ({
    context: contextProvider({ identity: { ...identity, permissions }, organization: { id: organizationId } }),
    clock: fixedClock, ids, store, branding: brandingNormalizer, cubeIdentity: "invoicing",
  })
  const input = { documentType: "invoice" as const, series: "INV" }
  const first = createInvoicingService(dependencies("org-1"))
  const second = createInvoicingService(dependencies("org-2"))
  await Effect.runPromise(first.addDocumentSeries(input))
  assert.deepEqual(await Effect.runPromise(second.listDocumentSeries()), [])
  await Effect.runPromise(second.addDocumentSeries(input))
  assert.deepEqual(await Effect.runPromise(first.listDocumentSeries()), [{ organizationId: "org-1", ...input }])
  assert.deepEqual(state.auditEvents.map(({ organizationId }) => organizationId), ["org-1", "org-2"])
  const before = structuredClone(state)
  const denied = createInvoicingService(dependencies("org-1", []))
  assert.ok(await Effect.runPromise(Effect.flip(denied.addDocumentSeries(input))) instanceof PermissionDenied)
  assert.ok(await Effect.runPromise(Effect.flip(denied.listDocumentSeries())) instanceof PermissionDenied)
  const failing = createInvoicingService({ ...dependencies("org-1"), store: {
    transaction: (use) => store.transaction((transaction) => use({ ...transaction,
      appendAuditEvent: () => Effect.fail(new DomainConflict({ code: "forced_audit_failure", message: "forced" })),
    })),
  } })
  const failure = await Effect.runPromise(Effect.flip(failing.addDocumentSeries({ ...input, series: "OTHER" })))
  assert.ok(failure instanceof DomainConflict && failure.code === "forced_audit_failure")
  assert.deepEqual(state, before)
})
