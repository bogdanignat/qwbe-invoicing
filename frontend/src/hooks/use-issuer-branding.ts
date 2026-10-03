"use client"

import { useState } from "react"

import { readBrandingImage } from "../lib/branding-image-file.ts"
import { createRevisionGuard } from "../lib/revision-guard.ts"
import { savedBrandingImage, type BrandingImageDraft } from "../lib/issuer-branding.ts"
import { brandingSelectionEffect } from "../lib/settings-revisions.ts"
import type { IssuerBranding } from "../lib/draft-models.ts"
import type { RevisionGuard } from "../lib/revision-guard.ts"

/**
 * The logo half of the settings form: the image in front of the user, whether
 * one is still being decoded, and why the last file was refused.
 *
 * The image is the only field read asynchronously, which is why it is held apart
 * from the typed form. Two guards meet here: the file guard, so a second file
 * chosen while the first decodes cannot be overwritten by the first one's
 * answer, and the form's edit guard, which a new image invalidates like any
 * other edit — a save answer that arrives after a logo was chosen must not
 * replace it with the profile's previous one.
 *
 * Which answers survive is decided in `settings-revisions.ts`; the decoding and
 * every limit live in `branding-image-file.ts` and `issuer-branding.ts`. What
 * is left here is state.
 */
/**
 * What the user just did to the logo. The settings form reacts to all three the
 * same way — they are edits, so the notice and the refusal that described the
 * previous state go with them — and to the two destructive ones by handing the
 * keyboard back, because their own buttons unmount as their effect.
 */
export type IssuerBrandingAction = "select" | "remove" | "discard"

export interface IssuerBrandingModel {
  readonly image: BrandingImageDraft | null
  /** A file is being decoded: the save waits rather than sending the previous logo. */
  readonly pending: boolean
  readonly imageIssue: string | undefined
  readonly select: (file: File | undefined) => void
  readonly remove: () => void
  readonly discardRefused: () => void
  /** Drops every override, so the form shows the profile the server answered with. */
  readonly reset: () => void
}

export const useIssuerBranding = (
  saved: IssuerBranding | null,
  editGuard: RevisionGuard,
): IssuerBrandingModel => {
  const [override, setOverride] = useState<{ readonly image: BrandingImageDraft | null } | undefined>(undefined)
  const [pending, setPending] = useState(false)
  const [imageIssue, setImageIssue] = useState<string | undefined>(undefined)
  // `useState(createRevisionGuard)` rather than `useRef(createRevisionGuard())`:
  // the same single instance, without building a guard on every render only to
  // throw it away, and without reading `.current` while rendering. Same reason
  // as the edit guard in `use-issuer-settings.ts`.
  const [fileGuard] = useState(createRevisionGuard)

  const forget = (): void => {
    fileGuard.invalidate()
    setPending(false)
    setImageIssue(undefined)
  }

  const select = (file: File | undefined): void => {
    if (file === undefined) return
    const revision = fileGuard.begin()
    editGuard.invalidate()
    setPending(true)
    setImageIssue(undefined)
    void readBrandingImage(file)
      .catch((cause: unknown) => ({
        kind: "issue" as const,
        message: cause instanceof Error ? cause.message : "Imaginea nu a putut fi citită.",
      }))
      .then((outcome) => {
        const effect = brandingSelectionEffect(fileGuard, revision, outcome)
        if (effect.kind === "ignore") return
        setPending(false)
        if (effect.kind === "issue") { setImageIssue(effect.message); return }
        editGuard.invalidate()
        setOverride({ image: effect.draft })
      })
  }

  return {
    image: override === undefined ? savedBrandingImage(saved) : override.image,
    pending,
    imageIssue,
    select,
    remove: () => { forget(); editGuard.invalidate(); setOverride({ image: null }) },
    discardRefused: () => { setImageIssue(undefined) },
    reset: () => { forget(); setOverride(undefined) },
  }
}

/**
 * The same model with every action announced before it runs.
 *
 * The three branding actions are edits like any other, but they do not go
 * through the form's `edit()`, so on their own they left the "saved" notice and
 * the refusal of the previous file standing over a form that no longer matched
 * either. Announcing them is a value the settings model decides on
 * (`use-issuer-settings.ts`) — what is here is only the wiring, and it is a plain
 * function because it has to be applied after the save hook exists.
 */
export const brandingActions = (
  branding: IssuerBrandingModel,
  onAction: (action: IssuerBrandingAction) => void,
): IssuerBrandingModel => ({
  ...branding,
  select: (file) => { if (file === undefined) return; onAction("select"); branding.select(file) },
  remove: () => { onAction("remove"); branding.remove() },
  discardRefused: () => { onAction("discard"); branding.discardRefused() },
})
