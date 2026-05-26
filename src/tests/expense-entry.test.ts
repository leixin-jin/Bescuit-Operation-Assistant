import { describe, expect, test, vi } from 'vitest'

import {
  normalizeManualExpenseInput,
  type ManualExpenseDraftInput,
} from '@/lib/server/app-domain'

describe('manual expense entry helpers', () => {
  test('normalizes a valid manual expense', () => {
    const input: ManualExpenseDraftInput = {
      date: '2026-05-25',
      supplierName: ' Makro Madrid ',
      amount: '42.105',
      note: '  compra urgente  ',
    }

    expect(normalizeManualExpenseInput(input, '2026-05-25T10:00:00.000Z')).toMatchObject({
      id: 'manual-expense-2026-05-25-1000000000',
      entryDate: '2026-05-25',
      amount: 42.11,
      vendor: 'Makro Madrid',
      note: 'compra urgente',
      sourceKind: 'manual',
      sourceId: 'manual-expense-2026-05-25-1000000000',
    })
  })

  test('generates distinct ids for default-created expenses on the same date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-25T10:00:00.000Z'))

    try {
      const input: ManualExpenseDraftInput = {
        date: '2026-05-25',
        supplierName: 'Makro Madrid',
        amount: '12',
        note: '',
      }

      const firstExpense = normalizeManualExpenseInput(input)
      const secondExpense = normalizeManualExpenseInput(input)

      expect(firstExpense.id).toMatch(/^manual-expense-2026-05-25-1000000000-/)
      expect(secondExpense.id).toMatch(/^manual-expense-2026-05-25-1000000000-/)
      expect(firstExpense.id).not.toBe(secondExpense.id)
      expect(firstExpense.sourceId).toBe(firstExpense.id)
      expect(secondExpense.sourceId).toBe(secondExpense.id)
    } finally {
      vi.useRealTimers()
    }
  })

  test('rejects blank supplier names', () => {
    expect(() =>
      normalizeManualExpenseInput({
        date: '2026-05-25',
        supplierName: '   ',
        amount: '12',
        note: '',
      }),
    ).toThrow('供应商不能为空')
  })

  test('rejects zero and negative amounts', () => {
    expect(() =>
      normalizeManualExpenseInput({
        date: '2026-05-25',
        supplierName: 'Makro Madrid',
        amount: '0',
        note: '',
      }),
    ).toThrow('支出金额必须大于 0')

    expect(() =>
      normalizeManualExpenseInput({
        date: '2026-05-25',
        supplierName: 'Makro Madrid',
        amount: '-1',
        note: '',
      }),
    ).toThrow('支出金额必须大于 0')
  })
})
