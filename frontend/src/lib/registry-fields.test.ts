import assert from "node:assert/strict"
import test from "node:test"

import {
  CUSTOMER_FORM, PRODUCT_FORM, registryFieldAria, registryFieldId, registryIssueId,
} from "./registry-fields.ts"

void test("the refused control is the only one marked, and it names its message", () => {
  const aria = registryFieldAria(CUSTOMER_FORM, "fiscalIdentifier")
  const refused = aria("fiscalIdentifier")
  assert.equal(refused["aria-invalid"], true)
  assert.equal(refused["aria-describedby"], registryIssueId(CUSTOMER_FORM, "fiscalIdentifier"))
  // The message the screen renders under that control answers to the same id,
  // which is what makes the description resolve rather than dangle.
  assert.equal(refused["aria-describedby"], "customer-fiscalIdentifier-issue")
  const other = aria("name")
  assert.equal(other["aria-invalid"], undefined)
  assert.equal(other["aria-describedby"], undefined)
  assert.equal(other.id, registryFieldId(CUSTOMER_FORM, "name"))
})

void test("with nothing refused no control is marked or described", () => {
  const aria = registryFieldAria(PRODUCT_FORM, undefined)
  for (const field of ["description", "unitOfMeasure", "unitPrice", "preferredVatRateCode"]) {
    assert.deepEqual(aria(field), {
      id: `product-${field}`, "aria-invalid": undefined, "aria-describedby": undefined,
    })
  }
})

// The two registries render at different times but share the id space of one
// document; a field named the same on both must not collide.
void test("the two forms keep their ids apart", () => {
  assert.notEqual(registryFieldId(CUSTOMER_FORM, "name"), registryFieldId(PRODUCT_FORM, "name"))
  assert.notEqual(registryFieldId(CUSTOMER_FORM, "name"), registryIssueId(CUSTOMER_FORM, "name"))
})
