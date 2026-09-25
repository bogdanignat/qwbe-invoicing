import { isTransientFailure } from "./api-errors.ts"
import { resourceFailure, type ResourceSnapshot } from "./async-resource.ts"

/**
 * Whether a registry screen may show its two panels yet, decided over the reads
 * it cannot open without.
 *
 * Both master-data screens have the same shape — a list on the left, an editor
 * on the right — and the same three-way answer: nothing yet, a read that failed,
 * or everything present. Deciding it here keeps the order of the refusals a
 * tested fact and keeps the hooks to wiring.
 *
 * A read that already holds data and is merely refetching is *not* pending:
 * a background refresh must not blank a screen that is being typed into. A read
 * that failed while holding nothing names itself in `reload`, so the retry asks
 * again for exactly what is missing.
 */
export type RegistryLoad =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly error: Error; readonly reload: ReadonlyArray<string> }
  | { readonly kind: "ready" }

export type RegistryRead = readonly [name: string, snapshot: ResourceSnapshot<unknown>]

export const registryLoad = (reads: ReadonlyArray<RegistryRead>): RegistryLoad => {
  const absent = reads.filter(([, snapshot]) => snapshot.data === undefined)
  if (absent.length === 0) return { kind: "ready" }
  const failed = absent.find(([, snapshot]) => snapshot.error !== null && snapshot.error !== undefined)
  // A failure wins over a sibling still in flight: the screen says what broke
  // instead of spinning until the slowest read gives up too.
  if (failed !== undefined) {
    return { kind: "error", error: resourceFailure(failed[1].error), reload: absent.map(([name]) => name) }
  }
  return { kind: "loading" }
}

/**
 * The retry a registry screen may offer, or nothing.
 *
 * Only a failure a repeat could answer differently earns a button: a `403` or a
 * `404` on a listing is a settled answer, and a "Reîncearcă" that replays it
 * says the screen did not read what came back. When one is warranted it asks
 * again for exactly the reads still missing — a resource that answered is not
 * refetched.
 */
export const registryReload = (
  load: RegistryLoad,
  refetch: Readonly<Record<string, () => void>>,
): (() => void) | undefined => {
  if (load.kind !== "error" || !isTransientFailure(load.error)) return undefined
  const { reload } = load
  return () => { for (const name of reload) refetch[name]?.() }
}
