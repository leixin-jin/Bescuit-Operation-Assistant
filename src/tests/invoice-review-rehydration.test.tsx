// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { afterEach, describe, expect, test, vi } from 'vitest'

declare module 'vitest' {
  interface Assertion<T = any> {
    toBeInTheDocument(): T
    toBeChecked(): T
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
  toBeChecked(received: Element | null) {
    const pass =
      received instanceof HTMLElement &&
      (received.getAttribute('aria-checked') === 'true' ||
        (received instanceof HTMLInputElement && received.checked))

    return {
      pass,
      message: () =>
        pass ? 'expected element not to be checked' : 'expected element to be checked',
    }
  },
})

vi.mock('@/styles/globals.css?url', () => ({
  default: '/test.css',
}))

vi.mock('@/lib/entry-completion-toast', () => ({
  showEntryCompletionToast: vi.fn((message: string) => {
    const toastElement = document.createElement('section')
    toastElement.setAttribute('aria-label', 'entry completion toast')
    toastElement.dataset.testid = 'entry-completion-toast'

    const titleElement = document.createElement('div')
    titleElement.textContent = '输入完成'
    toastElement.append(titleElement)

    const descriptionElement = document.createElement('div')
    descriptionElement.textContent = message
    toastElement.append(descriptionElement)

    document.body.append(toastElement)
    window.setTimeout(() => toastElement.remove(), 3000)
  }),
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
                priceComparison: {
                  status: 'changed' as const,
                  previousPrice: 25.62,
                  previousInvoiceDate: '2026-05-19',
                  previousSupplierName: 'VINOS ISABEL MARIA CRUSAT SA',
                  delta: -0.01,
                  deltaPercent: -0.04,
                  direction: 'down' as const,
                },
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
              excludeFromPriceTracking: true,
              priceComparison: { status: 'excluded' as const },
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
  test('gives invoice details more desktop space than the document preview', async () => {
    await renderRoute('/invoices/review/booked-review-job')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '发票核对' })).toBeTruthy()
    })

    const documentPane = document.querySelector('[data-testid="invoice-review-document-pane"]')
    const detailsPane = document.querySelector('[data-testid="invoice-review-details-pane"]')

    expect(documentPane).toBeTruthy()
    expect(detailsPane).toBeTruthy()
    expect(documentPane?.className ?? '').toContain('lg:w-[42%]')
    expect(detailsPane?.className ?? '').toContain('lg:w-[58%]')
  })

  test('client rehydrates the session-backed job after a loader miss', async () => {
    await renderRoute('/invoices/review/rehydrated-review-job')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '发票核对' })).toBeTruthy()
    })

    expect(screen.getAllByText(/rehydrated-review\.pdf/).length).toBeGreaterThan(0)
  })

  test('invoice review shows a 3 second completion toast after saving a draft', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    try {
      await renderRoute('/invoices/review/rehydrated-review-job')

      expect(await screen.findByRole('heading', { name: '发票核对' })).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /保存草稿/ }))

      const completionToast = await screen.findByTestId('entry-completion-toast')
      expect(within(completionToast).getByText('输入完成')).toBeTruthy()
      expect(within(completionToast).getByText('发票草稿已保存。')).toBeTruthy()

      await act(async () => {
        vi.advanceTimersByTime(3000)
      })

      await waitFor(() => {
        expect(screen.queryByTestId('entry-completion-toast')).toBeNull()
      })
    } finally {
      vi.useRealTimers()
    }
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

  test('rehydrates price tracking exclusion state and comparison status', async () => {
    await renderRoute('/invoices/review/review-tax-inclusive-job')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '发票核对' })).toBeTruthy()
    })

    expect(screen.getByLabelText('不计入价格追踪')).toBeChecked()
    expect(screen.getByText('已排除价格追踪')).toBeInTheDocument()
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

  test('shows price comparison badges from hydrated review data', async () => {
    await renderRoute('/invoices/review/booked-review-job')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '发票核对' })).toBeTruthy()
    })

    expect(screen.getByText('较上次下降 €0.01 (0.0%) vs 2026-05-19')).toBeInTheDocument()
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

  test('keeps the cursor position while editing a line item amount', async () => {
    await renderRoute('/invoices/review/review-tax-inclusive-job')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '发票核对' })).toBeTruthy()
    })

    const unitPriceInput = screen.getByDisplayValue('25.61') as HTMLInputElement
    unitPriceInput.focus()
    unitPriceInput.setSelectionRange(3, 4)

    fireEvent.change(unitPriceInput, {
      target: {
        value: '25.1',
        selectionStart: 3,
        selectionEnd: 3,
      },
    })

    const editedInput = screen.getByDisplayValue('25.1') as HTMLInputElement

    expect(document.activeElement).toBe(editedInput)
    expect(editedInput.selectionStart).toBe(3)
    expect(editedInput.selectionEnd).toBe(3)
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
