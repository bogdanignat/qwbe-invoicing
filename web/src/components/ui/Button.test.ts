import assert from "node:assert/strict"
import test from "node:test"

import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createServer } from "vite"

import type { ButtonProps } from "./Button.tsx"
import type { ButtonLinkProps } from "./ButtonLink.tsx"

void test("renders accessible button primitives with merged caller classes", async (context) => {
  const server = await createServer({ appType: "custom", server: { middlewareMode: true } })
  context.after(async () => { await server.close() })

  const buttonModule = await server.ssrLoadModule("/src/components/ui/Button.tsx") as {
    readonly Button: (props: ButtonProps) => ReactNode
  }
  const linkModule = await server.ssrLoadModule("/src/components/ui/ButtonLink.tsx") as {
    readonly ButtonLink: (props: ButtonLinkProps) => ReactNode
  }

  const button = renderToStaticMarkup(createElement(buttonModule.Button, { className: "px-8", children: "Salvează" }))
  assert.match(button, /data-slot="button"/)
  assert.match(button, /type="button"/)
  assert.match(button, /px-8/)
  assert.doesNotMatch(button, /px-4/)

  const submit = renderToStaticMarkup(createElement(buttonModule.Button, { variant: "secondary", fullWidth: true, type: "submit", children: "Trimite" }))
  assert.match(submit, /type="submit"/)
  assert.match(submit, /border-invoice-secondary-border/)
  assert.match(submit, /w-full/)

  const link = renderToStaticMarkup(createElement(linkModule.ButtonLink, { href: "/invoices", children: "Facturi" }))
  assert.match(link, /^<a /)
  assert.match(link, /href="\/invoices"/)
  assert.match(link, /data-slot="button"/)
  assert.doesNotMatch(link, /type=/)
})
