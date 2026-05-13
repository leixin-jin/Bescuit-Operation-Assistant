// @vitest-environment jsdom

import type * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/styles/globals.css?url', () => ({
  default: '/test.css',
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
  test('client rehydrates recent jobs after the loader misses session-backed data', async () => {
    await renderRoute('/invoices/new')

    expect(await screen.findByRole('heading', { name: '发票 intake' })).toBeTruthy()

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
})
