// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { afterEach, describe, expect, test, vi } from 'vitest'

declare module 'vitest' {
  interface Assertion<T = any> {
    toBeInTheDocument(): T
  }
}

expect.extend({
  toBeInTheDocument(received: Element | null) {
    const pass = received !== null && document.body.contains(received)

    return {
      pass,
      message: () =>
        pass
          ? 'expected element not to be in the document'
          : 'expected element to be in the document',
    }
  },
})

vi.mock('@/styles/globals.css?url', () => ({
  default: '/test.css',
}))

vi.mock('@/lib/server/queries/invoices', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/queries/invoices')>(
    '@/lib/server/queries/invoices',
  )
  const reviewCallsByJobId = new Map<string, number>()

  return {
    ...actual,
    getInvoiceReviewPageData: vi.fn(async (jobId: string) => {
      const reviewCalls = (reviewCallsByJobId.get(jobId) ?? 0) + 1
      reviewCallsByJobId.set(jobId, reviewCalls)

      if (jobId === 'rehydrated-review-job' && reviewCalls === 1) {
        return {
          job: null,
          ingredientOptions: actual.ingredientOptions,
        }
      }

      if (jobId === 'booked-review-job') {
        return {
          job: {
            jobId,
            fileName: 'booked-review.pdf',
            uploadedAt: '2026-04-24T11:00:00.000Z',
            pageCount: 1,
            status: 'ready' as const,
            stage: 'ready' as const,
            errorMessage: null,
            header: {
              supplier: 'VINOS ISABEL MARIA CRUSAT SA',
              invoiceNo: 'FP26020968',
              date: '2026-04-21',
              totalAmount: '106.67',
              taxAmount: '18.51',
              notes: '',
            },
            lineItems: [
              {
                id: 'line-booked-1',
                name: 'ESTRELLA GALICIA 24x33 cl. RET',
                qty: '4.00',
                unit: 'unidad',
                unitPrice: '25.61',
                lineTotal: '102.45',
                taxRate: '21%',
                notes: '',
                ingredient: '',
                matched: false,
              },
            ],
          },
          ingredientOptions: actual.ingredientOptions,
        }
      }

      if (jobId === 'recheck-review-job') {
        const recheckCalls = (
          globalThis as typeof globalThis & { __invoiceRecheckCalls?: number }
        ).__invoiceRecheckCalls ?? 0

        return {
          job: {
            jobId,
            fileName: 'recheck-review.pdf',
            uploadedAt: '2026-04-24T11:00:00.000Z',
            pageCount: 1,
            status: 'needs_review' as const,
            stage: 'needs_review' as const,
            errorMessage: null,
            header: {
              supplier: recheckCalls > 0 ? 'Fresh Supplier' : 'Old Supplier',
              invoiceNo: recheckCalls > 0 ? 'INV-FRESH' : 'INV-OLD',
              date: '2026-04-24',
              totalAmount: '99.90',
              taxAmount: '9.99',
              notes: '',
            },
            lineItems: [
              {
                id: 'line-recheck-1',
                name: '柠檬',
                qty: '3',
                unit: 'kg',
                unitPrice: '25.61',
                lineTotal: '76.83',
                ingredient: '',
                matched: false,
              },
            ],
          },
          ingredientOptions: actual.ingredientOptions,
        }
      }

      if (jobId === 'recheck-network-error-job') {
        return {
          job: {
            jobId,
            fileName: 'recheck-network-error.pdf',
            uploadedAt: '2026-04-24T11:00:00.000Z',
            pageCount: 1,
            status: 'needs_review' as const,
            stage: 'needs_review' as const,
            errorMessage: null,
            header: {
              supplier: 'Old Supplier',
              invoiceNo: 'INV-OLD',
              date: '2026-04-24',
              totalAmount: '99.90',
              taxAmount: '9.99',
              notes: '',
            },
            lineItems: [
              {
                id: 'line-network-error-1',
                name: '柠檬',
                qty: '3',
                unit: 'kg',
                unitPrice: '25.61',
                ingredient: '',
                matched: false,
              },
            ],
          },
          ingredientOptions: actual.ingredientOptions,
        }
      }


      return {
        job: {
          jobId,
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
              unitPrice: '25.61',
              lineTotal: '102.45',
              taxRate: '21%',
              notes: 'Descuento: 42,33',
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

vi.mock('@/lib/server/mutations/invoices', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/mutations/invoices')>(
    '@/lib/server/mutations/invoices',
  )

  return {
    ...actual,
    recheckInvoiceReviewJob: vi.fn(async (jobId: string) => {
      if (jobId === 'recheck-network-error-job') {
        throw new Error('Failed to fetch')
      }

      ;(
        globalThis as typeof globalThis & { __invoiceRecheckCalls?: number }
      ).__invoiceRecheckCalls =
        ((globalThis as typeof globalThis & { __invoiceRecheckCalls?: number })
          .__invoiceRecheckCalls ?? 0) + 1

      const { getInvoiceReviewPageData } = await import('@/lib/server/queries/invoices')
      const pageData = await getInvoiceReviewPageData(jobId)
      return pageData.job
    }),
  }
})

vi.mock('@/lib/server/mutations/invoices.rpc', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/server/mutations/invoices.rpc')
  >('@/lib/server/mutations/invoices.rpc')

  return {
    ...actual,
    recheckInvoiceReviewJobServerFn: vi.fn(async ({ data }: { data: { jobId: string } }) => {
      if (data.jobId === 'recheck-network-error-job') {
        throw new Error('Failed to fetch')
      }

      ;(
        globalThis as typeof globalThis & { __invoiceRecheckCalls?: number }
      ).__invoiceRecheckCalls =
        ((globalThis as typeof globalThis & { __invoiceRecheckCalls?: number })
          .__invoiceRecheckCalls ?? 0) + 1

      const { getInvoiceReviewPageData } = await import('@/lib/server/queries/invoices')
      const pageData = await getInvoiceReviewPageData(data.jobId)
      return pageData.job
    }),
  }
})

afterEach(() => {
  delete (globalThis as typeof globalThis & { __invoiceRecheckCalls?: number })
    .__invoiceRecheckCalls
  cleanup()
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
      expect(screen.getByRole('heading', { name: '发票核对' })).toBeTruthy()
    })

    expect(screen.getAllByText(/rehydrated-review\.pdf/).length).toBeGreaterThan(0)
  })

  test('shows tax-inclusive pricing details without ingredient mapping UI', async () => {
    await renderRoute('/invoices/review/review-tax-inclusive-job')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '发票核对' })).toBeTruthy()
    })

    expect(screen.getByText('IVA')).toBeInTheDocument()
    expect(screen.getByText('21%')).toBeInTheDocument()
    expect(screen.getByDisplayValue('25.61')).toBeInTheDocument()
    expect(screen.getByText('€102.45')).toBeInTheDocument()
    expect(screen.getByText('Descuento: 42,33')).toBeInTheDocument()
    expect(screen.queryByText('原料映射')).not.toBeInTheDocument()
    expect(screen.queryByText(/未映射到原料库/)).not.toBeInTheDocument()
  })

  test('shows booked review jobs with a green header status badge', async () => {
    await renderRoute('/invoices/review/booked-review-job')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '发票核对' })).toBeTruthy()
    })

    const bookedBadge = screen.getByText('已入账')
    expect(bookedBadge.className).toContain('bg-emerald-100')
    expect(bookedBadge.className).toContain('text-emerald-700')
  })

  test('recalculates line total display after quantity or unit price edits', async () => {
    await renderRoute('/invoices/review/review-tax-inclusive-job')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '发票核对' })).toBeTruthy()
    })

    fireEvent.change(screen.getByDisplayValue('25.61'), {
      target: { value: '30.00' },
    })

    expect(screen.queryByText('€102.45')).not.toBeInTheDocument()
    expect(screen.getByText('€90.00')).toBeInTheDocument()
  })

  test('recheck button reruns invoice extraction and refreshes the review draft', async () => {
    await renderRoute('/invoices/review/recheck-review-job')

    await waitFor(() => {
      expect(screen.getByDisplayValue('Old Supplier')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /重新核对/ }))

    await waitFor(() => {
      expect(screen.getByDisplayValue('Fresh Supplier')).toBeInTheDocument()
    })
    expect(screen.getByDisplayValue('INV-FRESH')).toBeInTheDocument()
  })

  test('shows a localized retry hint when the recheck request cannot reach the server', async () => {
    await renderRoute('/invoices/review/recheck-network-error-job')

    await waitFor(() => {
      expect(screen.getByDisplayValue('Old Supplier')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /重新核对/ }))

    await waitFor(() => {
      expect(screen.getByText(/重新核对请求失败/)).toBeInTheDocument()
    })
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument()
  })
})
