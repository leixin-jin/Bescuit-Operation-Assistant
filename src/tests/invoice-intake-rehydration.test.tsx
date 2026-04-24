// @vitest-environment jsdom

import { act, render, screen, waitFor } from '@testing-library/react'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/styles/globals.css?url', () => ({
  default: '/test.css',
}))

const rehydratedJob = {
  jobId: 'rehydrated-intake-job',
  fileName: 'rehydrated-intake.pdf',
  uploadedAt: '2026-04-24T10:00:00.000Z',
  pageCount: 1,
  status: 'uploaded' as const,
  header: {
    supplier: '',
    invoiceNo: '',
    date: '2026-04-24',
    totalAmount: '',
    taxAmount: '',
    notes: 'rehydrated',
  },
  lineItems: [],
}

vi.mock('@/lib/server/queries/invoices', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/queries/invoices')>(
    '@/lib/server/queries/invoices',
  )
  let listCalls = 0

  return {
    ...actual,
    listInvoiceJobs: vi.fn(async () => {
      listCalls += 1
      return listCalls === 1 ? [] : [rehydratedJob]
    }),
  }
})

async function renderRoute(initialPath: string) {
  vi.resetModules()

  const { routeTree } = await import('@/routeTree.gen')
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

describe('invoice intake route hydration', () => {
  test('client rehydrates recent jobs after the loader misses session-backed data', async () => {
    await renderRoute('/invoices/new')

    expect(await screen.findByRole('heading', { name: '发票 intake' })).toBeTruthy()

    await waitFor(() => {
      expect(screen.getByText('rehydrated-intake.pdf')).toBeTruthy()
    })
  })
})
