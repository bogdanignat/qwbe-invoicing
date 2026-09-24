/**
 * Hands a fetched document to the browser's own download machinery.
 *
 * The bytes already crossed the BFF under the session cookie, so there is no
 * URL a second, unauthenticated navigation could use; an object URL is created
 * for the blob in hand, clicked once and revoked. The revoke is deferred rather
 * than immediate because the click is dispatched asynchronously — revoking in
 * the same turn can cancel the download it was meant to start.
 */
export const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.append(link)
  try {
    link.click()
  } finally {
    link.remove()
    window.setTimeout(() => { URL.revokeObjectURL(url) }, 1_000)
  }
}

export const documentFilename = (
  prefix: string,
  document: { readonly series: string; readonly number: number },
  extension: string,
): string => `${prefix}-${document.series}-${String(document.number)}.${extension}`
