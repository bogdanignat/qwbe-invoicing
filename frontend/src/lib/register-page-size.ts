/**
 * How many register rows a page asks for, remembered in this browser.
 *
 * Storage can be missing or refuse (private mode, a full quota, a policy): the
 * size is then the default, or the one chosen for this visit only. A stored
 * value that is not one of the offered sizes is ignored rather than sent.
 */
export const PAGE_SIZES = [20, 50, 100] as const

export type PageSize = typeof PAGE_SIZES[number]

export const DEFAULT_PAGE_SIZE: PageSize = 20

const STORAGE_KEY = "qwbe.invoice-register.page-size"

export const pageSizeFrom = (value: string | null): PageSize | undefined =>
  PAGE_SIZES.find((size) => String(size) === value)

export const readPageSize = (): PageSize => {
  try {
    return pageSizeFrom(window.localStorage.getItem(STORAGE_KEY)) ?? DEFAULT_PAGE_SIZE
  } catch {
    return DEFAULT_PAGE_SIZE
  }
}

export const rememberPageSize = (size: PageSize): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(size))
  } catch {
    // Not remembered: the choice still applies until the page is left.
  }
}
