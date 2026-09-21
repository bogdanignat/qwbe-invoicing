import assert from "node:assert/strict"
import test from "node:test"

import { submitLogin } from "./login-submit.ts"

void test("keeps the form action pending until the transient login request settles", async () => {
  const formData = new FormData()
  formData.set("token", "transient-secret")
  let received: string | undefined
  let resolveLogin: (() => void) | undefined
  const loginSettled = new Promise<void>((resolve) => { resolveLogin = resolve })
  let actionSettled = false
  const action = submitLogin(formData, (token) => {
    received = token
    return loginSettled
  }).then(() => { actionSettled = true })

  await Promise.resolve()
  assert.equal(received, "transient-secret")
  assert.equal(actionSettled, false)
  resolveLogin?.()
  await action
  assert.equal(actionSettled, true)
})
