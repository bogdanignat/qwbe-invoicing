"use client"

import { useId, useState, type ComponentPropsWithRef, type KeyboardEvent, type ReactNode } from "react"

import { comboboxInputAttributes, comboboxKey, comboboxOptionAria } from "../../lib/combobox.ts"

type OwnAria = "role" | "aria-autocomplete" | "aria-expanded" | "aria-controls" | "aria-activedescendant"

type ComboboxProps<Option> = Omit<ComponentPropsWithRef<"input">, OwnAria> & {
  /** Off: a plain text input with no combobox attributes and no list, still the same element. */
  readonly suggest: boolean
  readonly options: ReadonlyArray<Option>
  readonly optionKey: (option: Option) => string
  readonly optionLabel: (option: Option) => ReactNode
  /** The listbox's accessible name, e.g. "Firme sugerate". */
  readonly listLabel: string
  readonly onPick: (option: Option) => void
  /** Escape or leaving the field: the owner empties `options`, which closes the list. */
  readonly onClose: () => void
}

const NO_OPTIONS: ReadonlyArray<never> = []

/**
 * A text input with a list of options under it, styled as `Input`. The list is
 * open exactly while `suggest` is on and `options` is not empty; the keyboard
 * and attribute rules are `lib/combobox.ts`. A click on an option keeps the
 * focus in the input.
 */
export const Combobox = <Option,>(props: ComboboxProps<Option>) => {
  const { suggest, optionKey, optionLabel, listLabel, onPick, onClose, className, onKeyDown, onBlur, ...input } = props
  const options = suggest ? props.options : NO_OPTIONS
  const listboxId = useId()
  // The active option belongs to the list it was chosen in; a new list starts with none.
  const [activeIn, setActiveIn] = useState({ options, index: -1 })
  const active = activeIn.options === options ? activeIn.index : -1

  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event)
    const action = comboboxKey(event.key, active, options.length)
    if (action.kind === "none") return
    event.preventDefault()
    if (action.kind === "move") setActiveIn({ options, index: action.index })
    if (action.kind === "close") onClose()
    const picked = action.kind === "pick" ? options[action.index] : undefined
    if (picked !== undefined) onPick(picked)
  }

  return <div className="relative">
    <input {...input} {...comboboxInputAttributes(suggest, listboxId, options.length, active)}
      className={["control", className].filter(Boolean).join(" ")}
      onKeyDown={keyDown} onBlur={(event) => { onBlur?.(event); onClose() }} />
    {suggest ? <ul id={listboxId} role="listbox" aria-label={listLabel} hidden={options.length === 0}
      className="absolute inset-x-0 top-full z-10 mt-1 max-h-64 list-none overflow-auto rounded-invoice-control border border-invoice-border bg-invoice-surface p-1 shadow-invoice-panel">
      {options.map((option, index) => <li key={optionKey(option)} {...comboboxOptionAria(listboxId, index, active)}
        ref={index === active ? (element) => { element?.scrollIntoView({ block: "nearest" }) } : undefined}
        className={["cursor-pointer rounded-invoice-control px-3 py-2 text-sm font-semibold text-invoice-ink",
          index === active ? "bg-invoice-primary-soft" : "hover:bg-invoice-primary-soft"].join(" ")}
        onMouseDown={(event) => { event.preventDefault() }}
        onClick={() => { onPick(option) }}>
        {optionLabel(option)}
      </li>)}
    </ul> : null}
  </div>
}
