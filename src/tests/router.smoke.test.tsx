// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { describe, expect, test, vi } from 'vitest'

import { createInvoiceJob, saveInvoiceJob } from '@/features/invoices/mock-store'
import { routeTree } from '@/routeTree.gen'

const analyticsMocks = vi.hoisted(() => ({
  getCalendarAnalyticsSummaryServerFn: vi.fn(),
  getMonthlyAnalyticsSummaryServerFn: vi.fn(),
}))

vi.mock('@/styles/globals.css?url', () => ({
  default: '/test.css',
}))

vi.mock('@/lib/server/queries/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/queries/analytics')>()
  const getSelectedMonth = (input?: { data?: { month?: string } }) =>
    input?.data?.month ?? '2026-05'
  const getMonthName = (month: string) => {
    const [year, monthNumber] = month.split('-')
    return `${year}年${Number.parseInt(monthNumber, 10)}月`
  }

  return {
    ...actual,
    getCalendarAnalyticsSummaryServerFn: analyticsMocks.getCalendarAnalyticsSummaryServerFn.mockImplementation(async (input) => {
      const selectedMonth = getSelectedMonth(input)

      return {
        selectedMonth,
        monthName: `日历标题 ${getMonthName(selectedMonth)}`,
        monthOptions: [],
        days: {},
        totalIncome: 0,
        totalExpense: 0,
      }
    }),
    getMonthlyAnalyticsSummaryServerFn: analyticsMocks.getMonthlyAnalyticsSummaryServerFn.mockImplementation(async (input) => {
      const selectedMonth = getSelectedMonth(input)

      return {
        selectedMonth,
        monthOptions: [],
        incomeBreakdown: [
          { name: 'BBVA', value: 0, percentage: 0 },
          { name: 'CAIXA', value: 0, percentage: 0 },
          { name: 'EFECTIVO', value: 0, percentage: 0 },
        ],
        expenseBreakdown: [],
        weeklyTrend: [],
        totalIncome: 0,
        totalExpense: 0,
        totalNet: 0,
        profitMargin: 0,
        incomeTrend: 0,
        expenseTrend: 0,
        netTrend: 0,
        marginDelta: 0,
      }
    }),
  }
})

vi.mock('@/components/year-month-picker', () => ({
  YearMonthPicker: ({
    value,
    onChange,
    yearLabel,
    monthLabel,
  }: {
    value: string
    onChange: (monthKey: string) => void
    yearLabel: string
    monthLabel: string
  }) => {
    const [year, month] = value.split('-')

    return (
      <div>
        <button type="button" aria-label={yearLabel}>
          {year}年
        </button>
        <button type="button" aria-label={monthLabel} onClick={() => onChange(`${year}-04`)}>
          {Number.parseInt(month, 10)}月
        </button>
      </div>
    )
  },
}))

async function renderRoute(initialPath = '/') {
  const history = createMemoryHistory({
    initialEntries: [initialPath],
  })

  const router = createRouter({
    routeTree,
    history,
    defaultPendingMs: 0,
  })

  await act(async () => {
    render(<RouterProvider router={router} />)
    await router.load()
  })

  return { router }
}

describe('phase 1-4 smoke tests', () => {
  test('home page exposes the key phase entry points', async () => {
    await renderRoute('/')

    expect(await screen.findByRole('heading', { name: '今天要做什么？' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /输入今日营业额/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /输入一张发票/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: '查看本月分析' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '日历概览' })).toBeTruthy()
  })

  test('legacy /calendar redirects to /analytics/calendar', async () => {
    const { router } = await renderRoute('/calendar')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/analytics/calendar')
    })

    expect(screen.getByRole('heading', { name: '日历概览' })).toBeTruthy()
  })

  test('legacy /invoices/review redirects to /invoices/new', async () => {
    const { router } = await renderRoute('/invoices/review')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/invoices/new')
    })

    expect(await screen.findByRole('heading', { name: '发票核对' })).toBeTruthy()
  })

  test('invoice intake recent tasks show booked jobs with a green status badge', async () => {
    const job = await createInvoiceJob('booked-upload.pdf')
    await saveInvoiceJob({
      ...job,
      stage: 'ready',
      status: 'ready',
      header: {
        supplier: 'VINOS ISABEL MARIA CRUSAT SA',
        invoiceNo: 'FP26020968',
        date: '2026-04-21',
        totalAmount: '106.67',
        taxAmount: '18.51',
        notes: '',
      },
    })

    await renderRoute('/invoices/new')

    const taskCard = screen.getByText('booked-upload.pdf').closest('div')
    expect(taskCard).toBeTruthy()
    const bookedBadge = Array.from(taskCard!.querySelectorAll('[data-slot="badge"]')).find(
      (element) => element.textContent === '已入账',
    )
    expect(bookedBadge).toBeTruthy()
    expect(bookedBadge!.className).toContain('bg-emerald-100')
    expect(bookedBadge!.className).toContain('text-emerald-700')
  })

  test('sales entry page derives efectivo from total minus card channels', async () => {
    await renderRoute('/sales/new')

    fireEvent.change(screen.getByLabelText('TOTAL'), {
      target: { value: '100' },
    })
    fireEvent.change(screen.getByLabelText('BBVA'), {
      target: { value: '35.50' },
    })
    fireEvent.change(screen.getByLabelText('CAIXA'), {
      target: { value: '20' },
    })

    expect(screen.getByText('€100.00')).toBeTruthy()
    expect((screen.getByLabelText('EFECTIVO') as HTMLInputElement).value).toBe(
      '44.50',
    )
  })

  test('sales entry page keeps incomplete decimal totals disabled', async () => {
    await renderRoute('/sales/new')

    fireEvent.change(screen.getByLabelText('TOTAL'), {
      target: { value: '.' },
    })

    expect((screen.getByRole('button', { name: /保存草稿/ }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect((screen.getByRole('button', { name: /确认提交/ }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  test('sales entry page blocks negative efectivo totals', async () => {
    await renderRoute('/sales/new')

    fireEvent.change(screen.getByLabelText('TOTAL'), {
      target: { value: '50' },
    })
    fireEvent.change(screen.getByLabelText('BBVA'), {
      target: { value: '40' },
    })
    fireEvent.change(screen.getByLabelText('CAIXA'), {
      target: { value: '20' },
    })

    expect(screen.getByText('TOTAL 不能小于 BBVA 和 CAIXA 的合计。')).toBeTruthy()
    expect((screen.getByLabelText('EFECTIVO') as HTMLInputElement).value).toBe(
      '-10.00',
    )
    expect((screen.getByRole('button', { name: /保存草稿/ }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect((screen.getByRole('button', { name: /确认提交/ }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  test('analytics calendar page renders monthly summary cards', async () => {
    await renderRoute('/analytics/calendar')

    expect(screen.getByRole('heading', { name: '日历概览' })).toBeTruthy()
    expect(screen.getByText('本月总收入')).toBeTruthy()
    expect(screen.getByText('本月总支出')).toBeTruthy()
    expect(screen.getByText('本月净利润')).toBeTruthy()
  })

  test('calendar day cells stack date, income, and expense vertically', async () => {
    analyticsMocks.getCalendarAnalyticsSummaryServerFn.mockImplementation(async (input) => {
      const selectedMonth =
        input?.data?.month ??
        new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' })
          .format(new Date())
          .slice(0, 7)

      return {
        selectedMonth,
        monthName: `日历标题 ${selectedMonth}`,
        monthOptions: [],
        days: {
          '4': {
            income: 1358,
            expense: 0,
          },
        },
        totalIncome: 0,
        totalExpense: 0,
      }
    })

    await renderRoute('/analytics/calendar')

    const dayCell = screen.getByTestId('calendar-day-4')

    await waitFor(() => {
      const dayContent = dayCell.firstElementChild
      const rows = Array.from(dayContent?.children ?? [])

      expect(dayContent?.className).toContain('flex-col')
      expect(dayContent?.className).not.toContain('grid-cols')
      expect(rows).toHaveLength(3)
      expect(rows[0]?.textContent).toBe('4')
      expect(rows[1]?.textContent).toContain('1358')
      expect(rows[2]?.textContent).toContain('0')
    })
  })

  test('monthly analytics exposes separate year and month selectors', async () => {
    await renderRoute('/analytics/monthly')

    expect(screen.getByRole('heading', { name: '数据分析' })).toBeTruthy()
    expect(screen.getByLabelText('分析年份')).toBeTruthy()
    expect(screen.getByLabelText('分析月份')).toBeTruthy()
  })

  test('calendar analytics exposes separate year and month selectors', async () => {
    await renderRoute('/analytics/calendar')

    expect(screen.getByRole('heading', { name: '日历概览' })).toBeTruthy()
    expect(screen.getByLabelText('日历年份')).toBeTruthy()
    expect(screen.getByLabelText('日历月份')).toBeTruthy()
    expect(screen.queryByText('日历标题 2026年5月')).toBeNull()
  })

  test('calendar month selector updates the selected month', async () => {
    await renderRoute('/analytics/calendar')

    fireEvent.click(screen.getByLabelText('日历月份'))
    await waitFor(() => {
      expect(screen.getByLabelText('日历月份').textContent).toContain('4月')
      expect(analyticsMocks.getCalendarAnalyticsSummaryServerFn).toHaveBeenCalledWith({
        data: { month: '2026-04' },
      })
    })
  })

  test('monthly analytics month selector can select a specific month', async () => {
    await renderRoute('/analytics/monthly')

    fireEvent.click(screen.getByLabelText('分析月份'))
    await waitFor(() => {
      expect(screen.getByLabelText('分析月份').textContent).toContain('4月')
      expect(analyticsMocks.getMonthlyAnalyticsSummaryServerFn).toHaveBeenCalledWith({
        data: { month: '2026-04' },
      })
    })
  })

  test('invoice review workbench renders the split preview and review sections', async () => {
    const job = await createInvoiceJob('smoke-upload.pdf')

    await renderRoute(`/invoices/review/${job.jobId}`)

    expect(await screen.findByRole('heading', { name: '发票核对' })).toBeTruthy()
    expect(screen.getByText('文档预览')).toBeTruthy()
    expect(screen.getByText('发票信息')).toBeTruthy()
    expect(screen.getByText('行项目')).toBeTruthy()
  })

  test('sidebar marks the current route as active', async () => {
    await renderRoute('/analytics/calendar')

    const activeLink = screen.getByRole('link', { name: '日历概览' })
    const inactiveLink = screen.getByRole('link', { name: '数据分析' })

    expect(activeLink.getAttribute('data-active')).toBe('true')
    expect(inactiveLink.getAttribute('data-active')).toBe('false')
  })
})
