const LOGICAL_PREFIX = "/api/"
const BROWSER_PREFIX = "/api/qwbe/"

export const browserApiPath = (logicalPath: string): string => {
  if (!logicalPath.startsWith(LOGICAL_PREFIX) || logicalPath.startsWith(BROWSER_PREFIX)) {
    throw new Error("Calea API logică este invalidă.")
  }
  return `${BROWSER_PREFIX}${logicalPath.slice(LOGICAL_PREFIX.length)}`
}
