import assert from "node:assert/strict"
import test from "node:test"

import { cn } from "../../classnames.ts"
import { buttonVariants } from "./button-variants.ts"

void test("builds typed invoice button variants", () => {
  assert.match(buttonVariants(), /bg-invoice-primary/)
  assert.match(buttonVariants({ variant: "secondary", size: "small", fullWidth: true }), /border-invoice-secondary-border/)
  assert.match(buttonVariants({ variant: "secondary", size: "small", fullWidth: true }), /min-h-8/)
  assert.match(buttonVariants({ variant: "secondary", size: "small", fullWidth: true }), /w-full/)
})

void test("merges conflicting Tailwind classes", () => {
  assert.equal(cn("px-2", "px-4"), "px-4")
  assert.equal(cn("rounded-invoice-control", "rounded-none"), "rounded-none")
})
