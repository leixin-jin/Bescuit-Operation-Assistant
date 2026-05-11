// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { describe, expect, test, vi } from 'vitest'

import { createInvoiceJob } from '@/features/invoices/mock-store'
import { routeTree } from '@/routeTree.gen'

vi.mock('@/styles/globals.css?url', () => ({
  default: '/test.css',
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

    expect(await screen.findByRole('heading', { name: '日历概览' })).toBeTruthy()
  })

  test('legacy /invoices/review redirects to /invoices/new', async () => {
    const { router } = await renderRoute('/invoices/review')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/invoices/new')
    })

    expect(await screen.findByRole('heading', { name: '发票 intake' })).toBeTruthy()
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

    expect(await screen.findByRole('heading', { name: '日历概览' })).toBeTruthy()
    expect(screen.getByText('本月总收入')).toBeTruthy()
    expect(screen.getByText('本月总支出')).toBeTruthy()
    expect(screen.getByText('本月净利润')).toBeTruthy()
  })

  test('monthly analytics exposes separate year and month selectors', async () => {
    await renderRoute('/analytics/monthly')

    expect(await screen.findByRole('heading', { name: '数据分析' })).toBeTruthy()
    expect(screen.getByLabelText('分析年份')).toBeTruthy()
    expect(screen.getByLabelText('分析月份')).toBeTruthy()
  })

  test('calendar analytics exposes separate year and month selectors', async () => {
    await renderRoute('/analytics/calendar')

    expect(await screen.findByRole('heading', { name: '日历概览' })).toBeTruthy()
    expect(screen.getByLabelText('日历年份')).toBeTruthy()
    expect(screen.getByLabelText('日历月份')).toBeTruthy()
  })

  test('invoice review workbench renders the split preview and review sections', async () => {
    const job = await createInvoiceJob('smoke-upload.pdf')

    await renderRoute(`/invoices/review/${job.jobId}`)

    expect(await screen.findByRole('heading', { name: '发票 review 工作台' })).toBeTruthy()
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
