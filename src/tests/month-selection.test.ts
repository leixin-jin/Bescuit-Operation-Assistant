import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  formatMonthKey,
  getMonthNumberOptions,
  getYearOptions,
  isValidMonthKey,
  shiftMonthKey,
  toMonthDate,
} from '@/lib/month-selection'

describe('month selection helpers', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('formats month keys with a padded month', () => {
    expect(formatMonthKey(2026, 4)).toBe('2026-04')
    expect(formatMonthKey(2026, 12)).toBe('2026-12')
  })

  test('validates YYYY-MM month keys', () => {
    expect(isValidMonthKey('2026-04')).toBe(true)
    expect(isValidMonthKey('2026-4')).toBe(false)
    expect(isValidMonthKey('2026-13')).toBe(false)
    expect(isValidMonthKey('abcd-04')).toBe(false)
  })

  test('builds a stable year range around the selected year', () => {
    expect(getYearOptions('2026-04', 2, 1)).toEqual([2024, 2025, 2026, 2027])
  })

  test('returns all calendar month numbers', () => {
    expect(getMonthNumberOptions()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  test('shifts month keys across year boundaries', () => {
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12')
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01')
  })

  test('creates a noon local date for the first day of the selected month', () => {
    const date = toMonthDate('2026-04')

    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(3)
    expect(date.getDate()).toBe(1)
    expect(date.getHours()).toBe(12)
  })

  test('falls back to the current Madrid month for invalid keys', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-31T22:30:00.000Z'))

    expect(getYearOptions('invalid-month', 0, 0)).toEqual([2026])
    expect(shiftMonthKey('invalid-month', 0)).toBe('2026-04')
  })
})
