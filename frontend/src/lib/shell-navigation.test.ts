import assert from "node:assert/strict"
import test from "node:test"

import { activeShellSection, SHELL_LINKS, shellNavigation } from "./shell-navigation.ts"

/**
 * The sidebar is the only way to reach most of the app, so what it offers and
 * what it calls current are checked as data — no markup involved.
 */

void test("the sidebar offers home first, then the five canonical sections, each exactly once", () => {
  assert.deepEqual(SHELL_LINKS.map((link) => link.href), [
    "/", "/invoices", "/proformas", "/customers", "/products", "/settings",
  ])
  assert.equal(SHELL_LINKS[0]?.label, "Acasă")
  assert.equal(new Set(SHELL_LINKS.map((link) => link.section)).size, SHELL_LINKS.length)
  assert.equal(SHELL_LINKS.every((link) => link.label !== ""), true)
})

void test("a document under a section keeps that section current", () => {
  assert.equal(activeShellSection("/invoices/inv-1"), "invoices")
  assert.equal(activeShellSection("/proformas/new"), "proformas")
  assert.equal(activeShellSection("/"), "home")
  assert.equal(activeShellSection(""), "home")
})

void test("the dashboard at / marks Acasă current, and nothing else", () => {
  assert.deepEqual(shellNavigation("/", true).filter((item) => item.current).map((item) => item.label), ["Acasă"])
  // A section's own paths never mark home as well.
  assert.deepEqual(shellNavigation("/invoices/inv-1", true).filter((item) => item.current).map((item) => item.href), ["/invoices"])
})

void test("exactly one link is current, and it is the one the path is in", () => {
  const current = shellNavigation("/proformas/prf-1", true).filter((item) => item.current)
  assert.deepEqual(current.map((item) => item.href), ["/proformas"])
})

void test("a path outside the sections marks nothing as current", () => {
  assert.equal(shellNavigation("/drafts/draft-1", true).some((item) => item.current), false)
  assert.equal(shellNavigation("/unlock", true).some((item) => item.current), false)
})

void test("a locked session has no current section: the links lead nowhere yet", () => {
  const locked = shellNavigation("/invoices", false)
  assert.equal(locked.some((item) => item.current), false)
  // The links themselves stay, exactly as before: only the marker is withheld.
  assert.equal(locked.length, SHELL_LINKS.length)
})
