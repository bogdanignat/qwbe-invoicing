import assert from "node:assert/strict"
import test from "node:test"

import { ApiFailure } from "./api-errors.ts"
import { createAuthController, type AuthSessionClient, type AuthSnapshot } from "./auth-controller.ts"
import type { AuthenticatedSession } from "./api-contracts.ts"

interface Deferred<Value> {
  readonly promise: Promise<Value>
  readonly resolve: (value: Value) => void
  readonly reject: (error: unknown) => void
}
const deferred = <Value>(): Deferred<Value> => {
  let resolvePromise: (value: Value) => void = () => undefined
  let rejectPromise: (error: unknown) => void = () => undefined
  const promise = new Promise<Value>((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}
const authenticated = (csrfToken: string): AuthenticatedSession => ({ authenticated: true, csrfToken })

const harness = (session: AuthSessionClient, pathname = "/unlock") => {
  let snapshot: AuthSnapshot = { status: "checking", error: undefined, loginPending: false, logoutPending: false }
  let clears = 0
  const navigation: Array<string> = []
  const controller = createAuthController({
    session,
    publish: (next) => { snapshot = next },
    clearCache: () => { clears += 1 },
    navigate: (path) => { navigation.push(path) },
    pathname: () => pathname,
  })
  controller.mount()
  return { controller, snapshot: () => snapshot, clears: () => clears, navigation }
}

void test("login supersedes restore, stale restore cannot settle, and duplicate login is coalesced", async () => {
  const restoring = deferred<AuthenticatedSession>()
  const loggingIn = deferred<AuthenticatedSession>()
  let loginCalls = 0
  let logoutCsrf: string | undefined
  const subject = harness({
    restore: () => restoring.promise,
    login: () => { loginCalls += 1; return loggingIn.promise },
    logout: (csrf) => { logoutCsrf = csrf; return Promise.resolve() },
  })
  const restore = subject.controller.restore()
  const login = subject.controller.login("first")
  assert.equal(subject.controller.login("second"), login)
  assert.equal(loginCalls, 1)
  loggingIn.resolve(authenticated("login-csrf"))
  await login
  restoring.resolve(authenticated("stale-csrf"))
  await restore
  assert.equal(subject.snapshot().status, "authenticated")
  await subject.controller.logout()
  assert.equal(logoutCsrf, "login-csrf")
})

void test("dispose aborts and prevents late restore settlement", async () => {
  const restoring = deferred<AuthenticatedSession>()
  const subject = harness({
    restore: () => restoring.promise,
    login: () => Promise.resolve(authenticated("csrf")),
    logout: () => Promise.resolve(),
  })
  const restore = subject.controller.restore()
  subject.controller.dispose()
  restoring.resolve(authenticated("late"))
  await restore
  assert.equal(subject.snapshot().status, "checking")
  assert.equal(subject.navigation.length, 0)
})

void test("duplicate logout is coalesced and 401 confirms an anonymous session", async () => {
  const loggingOut = deferred<undefined>()
  let logoutCalls = 0
  const subject = harness({
    restore: () => Promise.resolve(authenticated("csrf")),
    login: () => Promise.resolve(authenticated("csrf")),
    logout: () => { logoutCalls += 1; return loggingOut.promise },
  })
  await subject.controller.login("token")
  const first = subject.controller.logout()
  assert.equal(subject.controller.logout(), first)
  assert.equal(logoutCalls, 1)
  loggingOut.reject(new ApiFailure({ message: "expired", status: 401 }))
  await first
  assert.equal(subject.snapshot().status, "locked")
  assert.equal(subject.clears(), 2)
})

void test("dispose aborts logout without falsely confirming it", async () => {
  const loggingOut = deferred<undefined>()
  const subject = harness({
    restore: () => Promise.resolve(authenticated("csrf")),
    login: () => Promise.resolve(authenticated("csrf")),
    logout: () => loggingOut.promise,
  })
  await subject.controller.login("token")
  const logout = subject.controller.logout()
  subject.controller.dispose()
  const aborted = new Error("aborted")
  aborted.name = "AbortError"
  loggingOut.reject(aborted)
  await logout
  assert.equal(subject.snapshot().status, "authenticated")
  assert.equal(subject.clears(), 1)
})

void test("403 and 502 logout failures retain the authenticated session and permit retry", async () => {
  for (const status of [403, 502]) {
    let logoutCalls = 0
    const subject = harness({
      restore: () => Promise.resolve(authenticated("csrf")),
      login: () => Promise.resolve(authenticated("csrf")),
      logout: () => {
        logoutCalls += 1
        return logoutCalls === 1
          ? Promise.reject(new ApiFailure({ message: `failure-${String(status)}`, status }))
          : Promise.resolve()
      },
    })
    await subject.controller.login("token")
    await subject.controller.logout()
    assert.equal(subject.snapshot().status, "authenticated")
    const logoutError = subject.snapshot().error
    assert.match(logoutError instanceof Error ? logoutError.message : "", /sesiunea poate rămâne activă/)
    const retry = subject.controller.logout()
    assert.equal(subject.snapshot().error, logoutError)
    assert.equal(subject.snapshot().logoutPending, true)
    await retry
    assert.equal(subject.snapshot().status, "locked")
    assert.equal(logoutCalls, 2)
  }
})

void test("restore 403, 429, 502, and 504 withholds private content and can recover", async () => {
  for (const status of [403, 429, 502, 504]) {
    let calls = 0
    const subject = harness({
      restore: () => {
        calls += 1
        return calls === 1
          ? Promise.reject(new ApiFailure({ message: `failure-${String(status)}`, status }))
          : Promise.resolve(authenticated("csrf"))
      },
      login: () => Promise.resolve(authenticated("csrf")),
      logout: () => Promise.resolve(),
    })
    await subject.controller.restore()
    assert.equal(subject.snapshot().status, "restore-error")
    assert.equal(subject.clears(), 0)
    await subject.controller.restore()
    assert.equal(subject.snapshot().status, "authenticated")
  }
})

void test("invalid login 401 remains visible while a shared unauthorized event owns session reset", async () => {
  const invalid = new ApiFailure({ message: "Tokenul API este incorect.", status: 401 })
  const subject = harness({
    restore: () => Promise.resolve(authenticated("csrf")),
    login: () => Promise.reject(invalid),
    logout: () => Promise.resolve(),
  })
  await subject.controller.login("bad")
  assert.equal(subject.snapshot().error, invalid)
  assert.equal(subject.clears(), 0)
  subject.controller.unauthorized()
  assert.equal(subject.snapshot().status, "locked")
  assert.equal(subject.snapshot().error, undefined)
  assert.equal(subject.clears(), 1)
})

void test("route guards send authenticated unlock away and locked private routes to unlock", async () => {
  const session: AuthSessionClient = {
    restore: () => Promise.resolve(authenticated("csrf")),
    login: () => Promise.resolve(authenticated("csrf")),
    logout: () => Promise.resolve(),
  }
  const onUnlock = harness(session)
  await onUnlock.controller.restore()
  assert.deepEqual(onUnlock.navigation, ["/invoices"])

  const onPrivateRoute = harness({
    ...session,
    restore: () => Promise.reject(new ApiFailure({ message: "expired", status: 401 })),
  }, "/invoices")
  await onPrivateRoute.controller.restore()
  assert.deepEqual(onPrivateRoute.navigation, ["/unlock"])
})
