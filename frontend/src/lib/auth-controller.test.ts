import assert from "node:assert/strict"
import test from "node:test"

import { ApiFailure } from "./api-errors.ts"
import { createAuthController, type AuthSessionClient, type AuthSnapshot } from "./auth-controller.ts"
import { createBrowserTransport } from "./browser-transport.ts"
import { createSessionClient } from "./session-client.ts"
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

void test("invalid login 401 stays visible and is not erased by an event no session owns", async () => {
  const invalid = new ApiFailure({ message: "Tokenul API este incorect.", status: 401 })
  const subject = harness({
    restore: () => Promise.resolve(authenticated("csrf")),
    login: () => Promise.reject(invalid),
    logout: () => Promise.resolve(),
  })
  await subject.controller.login("bad")
  assert.equal(subject.snapshot().status, "locked")
  assert.equal(subject.snapshot().error, invalid)
  assert.equal(subject.clears(), 0)

  // A refused login opens no session, so a shared unauthorized event reports the
  // end of nothing: wiping the cache and re-emitting `locked` here would only
  // replace the message the unlock screen is showing with a blank one.
  subject.controller.unauthorized(subject.controller.epoch())
  assert.equal(subject.snapshot().status, "locked")
  assert.equal(subject.snapshot().error, invalid)
  assert.equal(subject.clears(), 0)

  // Once a session really exists, the same event ends it and clears what it read.
  await subject.controller.restore()
  assert.equal(subject.snapshot().status, "authenticated")
  subject.controller.unauthorized(subject.controller.epoch())
  assert.equal(subject.snapshot().status, "locked")
  assert.equal(subject.snapshot().error, undefined)
  assert.equal(subject.clears(), 1)
})

void test("logout is a no-op outside an authenticated session and without a CSRF token", async () => {
  let logoutCalls = 0
  const session: AuthSessionClient = {
    restore: () => Promise.reject(new ApiFailure({ message: "expired", status: 401 })),
    login: () => Promise.resolve(authenticated("csrf")),
    logout: () => { logoutCalls += 1; return Promise.resolve() },
  }
  const checking = harness(session)
  await checking.controller.logout()
  assert.equal(checking.snapshot().status, "checking")

  const locked = harness(session)
  await locked.controller.restore()
  assert.equal(locked.snapshot().status, "locked")
  await locked.controller.logout()
  assert.equal(locked.snapshot().status, "locked")

  const restoreError = harness({ ...session, restore: () => Promise.reject(new ApiFailure({ message: "down", status: 502 })) })
  await restoreError.controller.restore()
  assert.equal(restoreError.snapshot().status, "restore-error")
  await restoreError.controller.logout()
  assert.equal(restoreError.snapshot().status, "restore-error")
  assert.equal(logoutCalls, 0)

  // An authenticated session that never received a CSRF token cannot prove the
  // intent to the server, so the request is withheld rather than sent unsigned.
  const withoutCsrf = harness({
    ...session,
    restore: () => Promise.resolve({ authenticated: true } as unknown as AuthenticatedSession),
  })
  await withoutCsrf.controller.restore()
  assert.equal(withoutCsrf.snapshot().status, "authenticated")
  await withoutCsrf.controller.logout()
  assert.equal(logoutCalls, 0)
  assert.equal(withoutCsrf.snapshot().status, "authenticated")
  assert.equal(withoutCsrf.snapshot().logoutPending, false)
  assert.equal(withoutCsrf.clears(), 0)
})

void test("a 401 from a superseded session is ignored while the current one still locks", async () => {
  const subject = harness({
    restore: () => Promise.resolve(authenticated("first")),
    login: () => Promise.resolve(authenticated("second")),
    logout: () => Promise.resolve(),
  })
  await subject.controller.restore()
  const stale = subject.controller.epoch()
  await subject.controller.login("token")
  assert.equal(subject.snapshot().status, "authenticated")
  const clearsAfterLogin = subject.clears()

  subject.controller.unauthorized(stale)
  assert.equal(subject.snapshot().status, "authenticated")
  assert.equal(subject.clears(), clearsAfterLogin)

  subject.controller.unauthorized(subject.controller.epoch())
  assert.equal(subject.snapshot().status, "locked")
  assert.equal(subject.clears(), clearsAfterLogin + 1)
})

void test("a session already closed absorbs every further 401 instead of clearing again", async () => {
  const subject = harness({
    restore: () => Promise.resolve(authenticated("csrf")),
    login: () => Promise.resolve(authenticated("csrf")),
    logout: () => Promise.resolve(),
  }, "/invoices")
  await subject.controller.restore()
  subject.controller.unauthorized(subject.controller.epoch())
  assert.equal(subject.snapshot().status, "locked")
  assert.equal(subject.clears(), 1)

  // The redirect to /unlock is asynchronous, so the private view stays mounted and
  // its reads run again against the session that just ended. Each one is refused
  // and reports the epoch it read on the way out, which is the current one: without
  // a closed session being remembered, every refusal would wipe the cache and push
  // another redirect, and the loop would last as long as the navigation does.
  for (let refusal = 0; refusal < 3; refusal += 1) subject.controller.unauthorized(subject.controller.epoch())
  assert.equal(subject.clears(), 1)
  assert.deepEqual(subject.navigation, ["/unlock"])
  assert.equal(subject.snapshot().status, "locked")
})

void test("a refused logout keeps the session, so a 401 issued before it still closes it", async () => {
  const subject = harness({
    restore: () => Promise.resolve(authenticated("csrf")),
    login: () => Promise.resolve(authenticated("csrf")),
    logout: () => Promise.reject(new ApiFailure({ message: "forbidden", status: 403 })),
  }, "/invoices")
  await subject.controller.restore()
  // A read that left before the logout attempt belongs to a session the refused
  // logout did not end: cancelling that operation must not disown its 401.
  const started = subject.controller.epoch()
  await subject.controller.logout()
  assert.equal(subject.snapshot().status, "authenticated")
  assert.equal(subject.controller.epoch(), started)

  subject.controller.unauthorized(started)
  assert.equal(subject.snapshot().status, "locked")
  assert.equal(subject.snapshot().error, undefined)
  assert.equal(subject.clears(), 1)
  assert.deepEqual(subject.navigation, ["/unlock"])
})

void test("a 401 during an in-flight logout ends the session without reporting it unconfirmed", async () => {
  const loggingOut = deferred<undefined>()
  const subject = harness({
    restore: () => Promise.resolve(authenticated("csrf")),
    login: () => Promise.resolve(authenticated("csrf")),
    logout: () => loggingOut.promise,
  }, "/invoices")
  await subject.controller.login("token")
  const clearsAfterLogin = subject.clears()
  const logout = subject.controller.logout()
  subject.controller.unauthorized(subject.controller.epoch())
  assert.equal(subject.snapshot().status, "locked")

  const aborted = new Error("aborted")
  aborted.name = "AbortError"
  loggingOut.reject(aborted)
  await logout
  assert.equal(subject.snapshot().status, "locked")
  assert.equal(subject.snapshot().error, undefined)
  assert.equal(subject.clears(), clearsAfterLogin + 1)
})

void test("a restore 401 closes the session once, owned by the restore rather than the shared event", async () => {
  const published: Array<string> = []
  const navigation: Array<string> = []
  let clears = 0
  let requests = 0
  let sharedEvents = 0
  let unauthorized: (epoch: number) => void = () => undefined
  let epoch = (): number => 0
  const transport = createBrowserTransport({
    fetch: () => {
      requests += 1
      return Promise.resolve(Response.json({ error: "invalid_session" }, { status: 401 }))
    },
    epoch: () => epoch(),
    onUnauthorized: (started) => { sharedEvents += 1; unauthorized(started) },
  })
  const controller = createAuthController({
    session: createSessionClient(transport),
    publish: (next) => { published.push(next.status) },
    clearCache: () => { clears += 1 },
    navigate: (path) => { navigation.push(path) },
    pathname: () => "/invoices",
  })
  unauthorized = controller.unauthorized
  epoch = controller.epoch
  controller.mount()
  await controller.restore()

  assert.equal(requests, 1)
  // The restore owns its own 401: the shared unauthorized event must not fire and
  // abort the very operation that is already handling the expired session.
  assert.equal(sharedEvents, 0)
  assert.equal(clears, 1)
  assert.deepEqual(published, ["checking", "locked"])
  assert.deepEqual(navigation, ["/unlock"])
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

// A download or any other mutation side effect reads `ownsEpoch` in its own
// completion callback: a request that already left cannot be unsent, so what it
// brings back is applied only if the session it belonged to is still in place.
void test("ownsEpoch tells a settled mutation whether its session still exists", async () => {
  const session: AuthSessionClient = {
    restore: () => Promise.resolve(authenticated("csrf")),
    login: () => Promise.resolve(authenticated("csrf")),
    logout: () => Promise.resolve(),
  }
  const subject = harness(session, "/invoices")
  assert.equal(subject.controller.ownsEpoch(subject.controller.epoch()), false)

  await subject.controller.restore()
  const started = subject.controller.epoch()
  assert.equal(subject.controller.ownsEpoch(started), true)

  await subject.controller.login("another-token")
  assert.equal(subject.controller.ownsEpoch(started), false)
  assert.equal(subject.controller.ownsEpoch(subject.controller.epoch()), true)

  await subject.controller.logout()
  assert.equal(subject.snapshot().status, "locked")
  assert.equal(subject.controller.ownsEpoch(subject.controller.epoch()), false)
})
