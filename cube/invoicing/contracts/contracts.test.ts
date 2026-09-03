import assert from "node:assert/strict"
import test from "node:test"

import {
  DomainConflict,
  PermissionDenied,
  ValidationFailure,
  invoicingPermissions,
} from "./index.ts"

void test("materializes permission names from the mounted cube identity", () => {
  assert.deepEqual(invoicingPermissions("mother/invoicing"), {
    read: "mother/invoicing:read",
    manageCustomers: "mother/invoicing:customer.manage",
    draftInvoices: "mother/invoicing:invoice.draft",
    issueInvoices: "mother/invoicing:invoice.issue",
    issueProformas: "mother/invoicing:proforma.issue",
    voidInvoices: "mother/invoicing:invoice.void",
    recordPayments: "mother/invoicing:payment.record",
    manageSettings: "mother/invoicing:settings.manage",
  })
})

void test("exposes failures as discriminated values", () => {
  const failures = [
    new PermissionDenied({ permission: "invoicing:invoice.issue" }),
    new ValidationFailure({ issues: ["customer is required"] }),
    new DomainConflict({ code: "invoice_number_taken", message: "Invoice number is already allocated" }),
  ]

  assert.deepEqual(failures.map((failure) => failure._tag), [
    "PermissionDenied",
    "ValidationFailure",
    "DomainConflict",
  ])
})
