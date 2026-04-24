// @vitest-environment jsdom

import { act, render, screen, waitFor } from '@testing-library/react'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/styles/globals.css?url', () => ({
  default: '/test.css',
}))

vi.mock('@/lib/server/queries/invoices', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/queries/invoices')>(
    '@/lib/server/queries/invoices',
  )
  let reviewCalls = 0

  return {
    ...actual,
    getInvoiceReviewPageData: vi.fn(async () => {
      reviewCalls += 1

      if (reviewCalls === 1) {
        return {
          job: null,
          ingredientOptions: actual.ingredientOptions,
        }
      }

      return {
        job: {
          jobId: 'rehydrated-review-job',
          fileName: 'rehydrated-review.pdf',
          uploadedAt: '2026-04-24T11:00:00.000Z',
          pageCount: 1,
          status: 'needs_review' as const,
          header: {
            supplier: 'Metro',
            invoiceNo: 'INV-REHYDRATED',
            date: '2026-04-24',
            totalAmount: '99.90',
            taxAmount: '9.99',
            notes: 'rehydrated',
          },
          lineItems: [
            {
              id: 'line-1',
              name: '柠檬',
              qty: '3',
              unit: 'kg',
              unitPrice: '2.10',
              ingredient: '',
              matched: false,
            },
          ],
        },
        ingredientOptions: actual.ingredientOptions,
      }
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

describe('invoice review route hydration', () => {
  test('client rehydrates the session-backed job after a loader miss', async () => {
    await renderRoute('/invoices/review/rehydrated-review-job')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '发票 review 工作台' })).toBeTruthy()
    })

    expect(screen.getAllByText(/rehydrated-review\.pdf/).length).toBeGreaterThan(0)
  })
})
