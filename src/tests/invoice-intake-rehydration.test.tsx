// @vitest-environment jsdom

import type * as React from 'react'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { describe, expect, test, vi } from 'vitest'

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

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  AlertDialogAction: ({
    children,
    ...props
  }: React.ComponentProps<'button'>) => <button {...props}>{children}</button>,
  AlertDialogCancel: ({
    children,
    ...props
  }: React.ComponentProps<'button'>) => <button {...props}>{children}</button>,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  AlertDialogTrigger: ({
    asChild: _asChild,
    children,
  }: {
    asChild?: boolean
    children: React.ReactNode
  }) => <>{children}</>,
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

const deleteInvoiceIntakeJobMock = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, deleted: true })),
)

vi.mock('@/lib/server/mutations/invoices', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/mutations/invoices')>(
    '@/lib/server/mutations/invoices',
  )

  return {
    ...actual,
    deleteInvoiceIntakeJob: deleteInvoiceIntakeJobMock,
  }
})

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
  test('keeps the original two-column card layout without horizontal overflow', async () => {
    await renderRoute('/invoices/new')

    expect(await screen.findByRole('heading', { name: '发票核对' })).toBeTruthy()

    const workspace = document.querySelector('[data-testid="invoice-intake-workspace"]')
    const grid = document.querySelector('[data-testid="invoice-intake-grid"]')
    const recentTasksList = document.querySelector('[data-testid="recent-tasks-list"]')
    const cards = document.querySelectorAll('[data-slot="card"]')

    expect(workspace).toBeTruthy()
    expect(workspace?.className ?? '').toContain('w-full')
    expect(workspace?.className ?? '').toContain('overflow-x-hidden')
    expect(workspace?.className ?? '').toContain('overflow-y-hidden')
    expect(grid).toBeTruthy()
    expect(grid?.className ?? '').toContain('min-h-0')
    expect(grid?.className ?? '').toContain('flex-1')
    expect(grid?.className ?? '').toContain('xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]')
    expect(cards[0]?.className ?? '').toContain('rounded-xl')
    expect(cards[1]?.className ?? '').toContain('rounded-xl')
    expect(cards[1]?.className ?? '').toContain('min-h-0')
    expect(recentTasksList).toBeTruthy()
    expect(recentTasksList?.className ?? '').toContain('overflow-y-auto')

    const fileInput = document.querySelector('#invoice-file')
    const cameraInput = document.querySelector('#invoice-camera-file')

    expect(fileInput?.className ?? '').toContain('absolute')
    expect(fileInput?.className ?? '').toContain('opacity-0')
    expect(fileInput?.className ?? '').not.toContain('hidden')
    expect(fileInput?.className ?? '').not.toContain('sr-only')
    expect(cameraInput?.className ?? '').toContain('absolute')
    expect(cameraInput?.className ?? '').toContain('opacity-0')
    expect(cameraInput?.className ?? '').not.toContain('hidden')
    expect(cameraInput?.className ?? '').not.toContain('sr-only')
  })

  test('client rehydrates recent jobs after the loader misses session-backed data', async () => {
    await renderRoute('/invoices/new')

    expect(await screen.findByRole('heading', { name: '发票核对' })).toBeTruthy()

    await waitFor(() => {
      expect(screen.getByText('rehydrated-intake.pdf')).toBeTruthy()
    })
  })

  test('users can delete an unfinished recent invoice task', async () => {
    await renderRoute('/invoices/new')

    expect(await screen.findByText('rehydrated-intake.pdf')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '删除 rehydrated-intake.pdf' }))
    fireEvent.click(await screen.findByRole('button', { name: '删除任务' }))

    await waitFor(() => {
      expect(deleteInvoiceIntakeJobMock).toHaveBeenCalledWith('rehydrated-intake-job')
    })
  })

  test('invoice intake shows a 3 second completion toast after creating a task', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    try {
      await renderRoute('/invoices/new')

      const file = new File(['invoice bytes'], 'toast-invoice.pdf', {
        type: 'application/pdf',
      })
      const input = document.querySelector('#invoice-file') as HTMLInputElement

      fireEvent.change(input, {
        target: { files: [file] },
      })
      fireEvent.click(screen.getByRole('button', { name: /创建任务/ }))

      const completionToast = await screen.findByTestId('entry-completion-toast')
      expect(within(completionToast).getByText('输入完成')).toBeTruthy()
      expect(within(completionToast).getByText('发票任务已创建。')).toBeTruthy()

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
})
