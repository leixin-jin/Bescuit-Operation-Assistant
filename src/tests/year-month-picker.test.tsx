// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import { YearMonthPicker } from '@/components/year-month-picker'

const originalHasPointerCapture = Element.prototype.hasPointerCapture
const originalSetPointerCapture = Element.prototype.setPointerCapture
const originalReleasePointerCapture = Element.prototype.releasePointerCapture

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn()
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

afterAll(() => {
  Element.prototype.hasPointerCapture = originalHasPointerCapture
  Element.prototype.setPointerCapture = originalSetPointerCapture
  Element.prototype.releasePointerCapture = originalReleasePointerCapture
})

describe('YearMonthPicker', () => {
  test('emits a padded month key when year or month changes', async () => {
    const handleChange = vi.fn()

    render(
      <YearMonthPicker
        value="2026-04"
        onChange={handleChange}
        yearLabel="分析年份"
        monthLabel="分析月份"
      />,
    )

    fireEvent.pointerDown(screen.getByLabelText('分析年份'), {
      button: 0,
      ctrlKey: false,
      pointerType: 'mouse',
    })
    fireEvent.click(
      within(await screen.findByRole('listbox')).getByRole('option', { name: '2027年' }),
    )

    expect(handleChange).toHaveBeenCalledWith('2027-04')

    handleChange.mockClear()

    fireEvent.pointerDown(screen.getByLabelText('分析月份'), {
      button: 0,
      ctrlKey: false,
      pointerType: 'mouse',
    })
    fireEvent.click(
      within(await screen.findByRole('listbox')).getByRole('option', { name: '11月' }),
    )

    expect(handleChange).toHaveBeenCalledWith('2026-11')
  })
})
