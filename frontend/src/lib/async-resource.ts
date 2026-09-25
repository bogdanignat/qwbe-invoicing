/**
 * What one asynchronous read says, in the three parts a screen's decision needs.
 *
 * Every screen that blocks on reads — the authoring forms, the two master-data
 * registries — asks the same question of them: is there data yet, is one still
 * in flight, did one fail. Keeping the shape and the failure conversion here
 * means neither side has to import the other's module to ask it: the registries
 * do not depend on proforma authoring, and authoring does not depend on the
 * registries.
 */
export interface ResourceSnapshot<T> {
  readonly data: T | undefined
  readonly isPending: boolean
  readonly error: unknown
}

/**
 * A rejection turned into something the screen can show. Query rejections are
 * `unknown`: an `Error` is kept as it is and a plain string becomes its own
 * message, while anything else gets a written message instead of the
 * `[object Object]` a bare `String(...)` would put in front of the user.
 */
export const resourceFailure = (cause: unknown): Error =>
  cause instanceof Error
    ? cause
    : new Error(typeof cause === "string" ? cause : "Încărcarea datelor a eșuat.")
