export const documentNotesMaxLength = 300

/** Mirrors the server-side remark rules so the textarea can explain an invisible paste before submitting. */
export const documentNotesIssue = (notes: string): string | null => {
  if (/(?!\n)[\p{Cc}\p{Zl}\p{Zp}]/u.test(notes)) {
    return "Observatiile nu pot contine caractere de control; inlocuieste tab-urile cu spatii."
  }
  return notes.trim().length > documentNotesMaxLength
    ? `Observatiile depasesc ${String(documentNotesMaxLength)} de caractere.`
    : null
}
