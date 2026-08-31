export const today = (): string => {
  const date = new Date()
  const twoDigits = (value: number): string => String(value).padStart(2, "0")
  return `${String(date.getFullYear())}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`
}

export const money = (value: string, currency = "RON"): string => `${value} ${currency}`
