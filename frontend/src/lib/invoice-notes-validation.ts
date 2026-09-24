export const documentNotesMaxLength = 300

/** Mirrors the server-side remark rules so the textarea can explain an invisible paste before submitting. */
export const documentNotesIssue = (notes: string): string | null => {
  if (/(?!\n)[\p{Cc}\p{Zl}\p{Zp}]/u.test(notes)) {
    return "Observațiile nu pot conține caractere de control; înlocuiește tab-urile cu spații."
  }
  return notes.trim().length > documentNotesMaxLength
    ? `Observațiile depășesc ${String(documentNotesMaxLength)} de caractere.`
    : null
}
