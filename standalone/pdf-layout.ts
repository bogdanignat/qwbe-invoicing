import { type PDFFont, type PDFPage, rgb } from "pdf-lib"

export const pageWidth = 595.28
export const pageHeight = 841.89
export const margin = 42
export const contentWidth = pageWidth - margin * 2
export const contentRight = pageWidth - margin
export const contentTop = pageHeight - margin

export const ink = rgb(0.09, 0.09, 0.11)
export const muted = rgb(0.47, 0.47, 0.52)
export const accent = rgb(0.11, 0.31, 0.85)
export const warning = rgb(0.7, 0.33, 0.03)
export const rule = rgb(0.87, 0.87, 0.9)
export const headerFill = rgb(0.945, 0.945, 0.96)
export const noteFill = rgb(0.976, 0.976, 0.984)
export const paper = rgb(1, 1, 1)

export type Align = "left" | "center" | "right"

export interface Fonts {
  readonly regular: PDFFont
  readonly bold: PDFFont
}

/**
 * Breaks text to fit `width`, preferring word boundaries and falling back to
 * character splitting for single words that are wider than the column.
 */
export const wrapText = (
  font: PDFFont,
  size: number,
  width: number,
  text: string,
): ReadonlyArray<string> => {
  const out: Array<string> = []
  const breakWord = (word: string): string => {
    let current = ""
    for (const character of Array.from(word)) {
      const candidate = `${current}${character}`
      if (current === "" || font.widthOfTextAtSize(candidate, size) <= width) current = candidate
      else {
        out.push(current)
        current = character
      }
    }
    return current
  }
  for (const paragraph of text.split("\n")) {
    let line = ""
    for (const word of paragraph.split(" ").filter((part) => part !== "")) {
      const candidate = line === "" ? word : `${line} ${word}`
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate
        continue
      }
      if (line !== "") out.push(line)
      line = font.widthOfTextAtSize(word, size) <= width ? word : breakWord(word)
    }
    if (line !== "") out.push(line)
  }
  return out.length === 0 ? [""] : out
}

export interface TextOptions {
  readonly x: number
  readonly y: number
  readonly size: number
  readonly font: PDFFont
  readonly color?: ReturnType<typeof rgb>
  readonly align?: Align
  readonly width?: number
}

/** Draws a single line, honouring horizontal alignment inside `width`. */
export const putText = (page: PDFPage, text: string, options: TextOptions): void => {
  const box = options.width ?? 0
  const advance = options.font.widthOfTextAtSize(text, options.size)
  const align = options.align ?? "left"
  const offset = align === "right" ? box - advance : align === "center" ? (box - advance) / 2 : 0
  page.drawText(text, {
    x: options.x + offset,
    y: options.y,
    size: options.size,
    font: options.font,
    color: options.color ?? ink,
  })
}

export interface BlockOptions extends Omit<TextOptions, "y"> {
  readonly top: number
  readonly leading: number
}

/** Draws consecutive lines downward from `top` and returns the next free baseline. */
export const putLines = (
  page: PDFPage,
  lines: ReadonlyArray<string>,
  options: BlockOptions,
): number => {
  let cursor = options.top
  for (const line of lines) {
    putText(page, line, { ...options, y: cursor })
    cursor -= options.leading
  }
  return cursor
}

export const horizontalRule = (
  page: PDFPage,
  y: number,
  options: { readonly thickness?: number; readonly color?: ReturnType<typeof rgb> } = {},
): void => {
  page.drawLine({
    start: { x: margin, y },
    end: { x: contentRight, y },
    thickness: options.thickness ?? 0.6,
    color: options.color ?? rule,
  })
}

const legalFormSuffixes = new Set(["srl", "sa", "sca", "snc", "scs", "pfa", "ii", "if", "sr", "s", "r", "l"])

/**
 * Derives up to two initials from a party name, skipping legal-form suffixes so
 * "Alpha Retail S.A." yields "AR" rather than "AS".
 */
export const nameInitials = (name: string): string => {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 0)
  const meaningful = words.filter((word) => !legalFormSuffixes.has(word.toLowerCase()))
  const chosen = meaningful.length > 0 ? meaningful : words
  const letters = chosen.slice(0, 2).map((word) => Array.from(word)[0]?.toLocaleUpperCase("ro-RO") ?? "")
  const joined = letters.join("")
  return joined === "" ? "?" : joined
}
