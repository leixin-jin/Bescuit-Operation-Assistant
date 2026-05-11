export interface YearRange {
  before?: number
  after?: number
}

export function formatMonthKey(year: number, month: number) {
  return [year.toString(), String(month).padStart(2, '0')].join('-')
}

export function isValidMonthKey(monthKey: string) {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    return false
  }

  const [, monthText] = monthKey.split('-')
  const month = Number.parseInt(monthText, 10)
  return month >= 1 && month <= 12
}

export function getMonthKeyParts(monthKey: string) {
  const fallbackMonthKey = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid',
  }).format(new Date()).slice(0, 7)
  const safeMonthKey = isValidMonthKey(monthKey) ? monthKey : fallbackMonthKey
  const [yearText, monthText] = safeMonthKey.split('-')

  return {
    year: Number.parseInt(yearText, 10),
    month: Number.parseInt(monthText, 10),
  }
}

export function getYearOptions(
  selectedMonth: string,
  before = 5,
  after = 1,
) {
  const { year } = getMonthKeyParts(selectedMonth)
  const startYear = year - before
  const endYear = year + after
  const years: number[] = []

  for (let currentYear = startYear; currentYear <= endYear; currentYear += 1) {
    years.push(currentYear)
  }

  return years
}

export function getMonthNumberOptions() {
  return Array.from({ length: 12 }, (_, index) => index + 1)
}

export function shiftMonthKey(monthKey: string, offset: number) {
  const date = toMonthDate(monthKey)
  date.setMonth(date.getMonth() + offset)
  return formatMonthKey(date.getFullYear(), date.getMonth() + 1)
}

export function toMonthDate(monthKey: string) {
  const { year, month } = getMonthKeyParts(monthKey)
  return new Date(year, month - 1, 1, 12)
}
