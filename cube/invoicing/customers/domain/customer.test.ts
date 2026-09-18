import assert from "node:assert/strict"
import test from "node:test"

import { ValidationFailure } from "../../contracts/failures.ts"
import { validateCustomer } from "../index.ts"

void test("bounds customer payment terms to a practical calendar range", () => {
  const customer = { partyType: "individual" as const, name: "Ana Pop", fiscalIdentifier: "", vatRegistered: false, address: {
    countryCode: "RO", city: "Botoșani", street: "Strada 1", county: "RO-BT",
  } }
  assert.doesNotThrow(() => { validateCustomer({ ...customer, defaultPaymentTermDays: 3650 }) })
  assert.throws(() => { validateCustomer({ ...customer, defaultPaymentTermDays: 3651 }) },
    (error: unknown) => error instanceof ValidationFailure
      && error.issues.includes("defaultPaymentTermDays must be an integer between 0 and 3650"))
})
