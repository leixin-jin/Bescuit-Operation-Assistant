import { describe, expect, test } from 'vitest'

import {
  deriveSalesChannelAmounts,
  getDerivedCashAmount,
} from '@/lib/server/app-domain'

describe('sales total-first entry helpers', () => {
  test('derives efectivo from total minus BBVA and CAIXA', () => {
    expect(
      deriveSalesChannelAmounts({
        total: '100',
        bbva: '35.50',
        caixa: '20',
      }),
    ).toEqual({
      bbva: '35.50',
      caixa: '20.00',
      efectivo: '44.50',
    })
  })

  test('rounds derived efectivo to cents', () => {
    expect(
      deriveSalesChannelAmounts({
        total: '10.005',
        bbva: '1.002',
        caixa: '2.003',
      }),
    ).toEqual({
      bbva: '1.00',
      caixa: '2.00',
      efectivo: '7.01',
    })
  })

  test('exposes negative efectivo so the UI can block impossible totals', () => {
    expect(
      getDerivedCashAmount({
        total: '50',
        bbva: '40',
        caixa: '20',
      }),
    ).toBe(-10)
  })
})
