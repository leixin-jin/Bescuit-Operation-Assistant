// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { describe, expect, test, vi } from 'vitest'

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

describe('phase 1-3 smoke tests', () => {
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

  test('sales entry page recomputes the total when channel amounts change', async () => {
    await renderRoute('/sales/new')

    fireEvent.change(screen.getByLabelText('BBVA'), {
      target: { value: '10.50' },
    })
    fireEvent.change(screen.getByLabelText('CAIXA'), {
      target: { value: '20' },
    })

    expect(screen.getByText('€30.50')).toBeTruthy()
  })

  test('analytics calendar page renders monthly summary cards', async () => {
    await renderRoute('/analytics/calendar')

    expect(await screen.findByRole('heading', { name: '日历概览' })).toBeTruthy()
    expect(screen.getByText('本月总收入')).toBeTruthy()
    expect(screen.getByText('本月总支出')).toBeTruthy()
    expect(screen.getByText('本月净利润')).toBeTruthy()
  })

  test('sidebar marks the current route as active', async () => {
    await renderRoute('/analytics/calendar')

    const activeLink = screen.getByRole('link', { name: '日历概览' })
    const inactiveLink = screen.getByRole('link', { name: '数据分析' })

    expect(activeLink.getAttribute('data-active')).toBe('true')
    expect(inactiveLink.getAttribute('data-active')).toBe('false')
  })
})
