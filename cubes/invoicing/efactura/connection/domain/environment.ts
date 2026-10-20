/**
 * The ANAF environment an installation talks to. `test` is the default and the
 * only one a development setup ever uses; `prod` exists only when written out.
 * Both the connection and every submission record theirs, so a switch of the
 * setting cannot silently carry on the work of the other environment.
 */
export const ANAF_ENVIRONMENTS = ["test", "prod"] as const
export type AnafEnvironment = (typeof ANAF_ENVIRONMENTS)[number]

export const isAnafEnvironment = (value: unknown): value is AnafEnvironment =>
  ANAF_ENVIRONMENTS.some((environment) => environment === value)

/**
 * The environments, other than the configured one, that existing submissions
 * were made in. Empty means the configured environment may serve; anything else
 * means `serve` refuses, because polling a `test` upload against `prod` (or the
 * reverse) would read another system's answer for that index.
 */
export const foreignEnvironments = (
  configured: AnafEnvironment,
  recorded: ReadonlyArray<string>,
): ReadonlyArray<string> => [...new Set(recorded.filter((environment) => environment !== configured))].sort()
