/**
 * A mutation needs the token that proves the session asked for it.
 *
 * Without one there is nothing to sign the request with, and the attempt would
 * fail as an opaque `403` from the API: failing here, with a message that names
 * the fix, is the honest answer. The token belongs to the session, so the hook
 * that holds the session decides when it is read.
 */
export const requireCsrf = (csrfToken: string | undefined): string => {
  if (csrfToken === undefined) throw new Error("Sesiunea nu mai poate semna cererea. Reîncarcă pagina.")
  return csrfToken
}
