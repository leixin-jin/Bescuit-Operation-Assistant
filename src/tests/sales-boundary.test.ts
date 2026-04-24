// @vitest-environment jsdom

import { beforeEach, describe, expect, test } from 'vitest'

import { getMadridTodayInputValue } from '@/lib/server/app-domain'
import { saveSalesDraft, submitSalesEntry } from '@/lib/server/mutations/sales'
import { getDashboardSummary } from '@/lib/server/queries/dashboard'
import { getCalendarAnalyticsSummary } from '@/lib/server/queries/analytics'
import { getSalesRecord } from '@/lib/server/queries/sales'

describe('sales query and mutation boundaries', () => {
  beforeEach(() => {
    const storage = createStorageMock()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: storage,
    })
  })

  test('draft sales stay editable but do not count as recorded daily revenue', async () => {
    const date = getMadridTodayInputValue()
    const month = date.slice(0, 7)
    const dayKey = String(Number.parseInt(date.slice(8, 10), 10))
    const baselineSummary = await getCalendarAnalyticsSummary(month)

    const draftRecord = await saveSalesDraft({
      date,
      amounts: {
        bbva: '100.00',
        caixa: '80.00',
        efectivo: '20.00',
      },
      notes: 'draft',
    })

    const storedDraftRecord = await getSalesRecord(date)
    const dashboardAfterDraft = await getDashboardSummary()
    const analyticsAfterDraft = await getCalendarAnalyticsSummary(month)

    expect(draftRecord.status).toBe('draft')
    expect(storedDraftRecord?.status).toBe('draft')
    expect(dashboardAfterDraft.salesRecordedToday).toBe(false)
    expect(analyticsAfterDraft.days[dayKey]).toEqual(baselineSummary.days[dayKey])
  })

  test('submitted sales count as recorded daily revenue and drive analytics', async () => {
    const date = getMadridTodayInputValue()
    const month = date.slice(0, 7)
    const dayKey = String(Number.parseInt(date.slice(8, 10), 10))

    const submittedRecord = await submitSalesEntry({
      date,
      amounts: {
        bbva: '100.00',
        caixa: '80.00',
        efectivo: '20.00',
      },
      notes: 'submitted',
    })

    const storedSubmittedRecord = await getSalesRecord(date)
    const dashboardAfterSubmit = await getDashboardSummary()
    const analyticsAfterSubmit = await getCalendarAnalyticsSummary(month)

    expect(submittedRecord.status).toBe('submitted')
    expect(storedSubmittedRecord?.status).toBe('submitted')
    expect(dashboardAfterSubmit.salesRecordedToday).toBe(true)
    expect(analyticsAfterSubmit.days[dayKey]?.income).toBe(200)
  })
})

function createStorageMock() {
  const store = new Map<string, string>()

  return {
    getItem(key: string) {
      return store.get(key) ?? null
    },
    setItem(key: string, value: string) {
      store.set(key, value)
    },
    removeItem(key: string) {
      store.delete(key)
    },
  }
}
