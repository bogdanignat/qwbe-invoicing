/** The 63 alphanumerics pg_dump 16.10+ generates for `\restrict`. */
export const restrictKey = "Ab3".repeat(21)

/** `body` framed the way pg_dump 16.10+ writes a plain dump. */
export const restrictedDump = (body = "SELECT 1;\n", key = restrictKey): string =>
  `--\n-- PostgreSQL database dump\n--\n\n\\restrict ${key}\n\n${body}\n--\n-- PostgreSQL database dump complete\n--\n\n`
  + `\\unrestrict ${key}\n\n`
