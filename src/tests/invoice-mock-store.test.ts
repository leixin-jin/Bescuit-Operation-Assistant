// @vitest-environment jsdom

import { beforeEach, describe, expect, test } from 'vitest'

import {
  createInvoiceJob,
  getInvoiceJob,
  getInvoiceReadinessSummary,
  listInvoiceJobs,
  saveInvoiceJob,
} from '@/features/invoices/mock-store'

describe('invoice mock store', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  test('unknown job ids do not create new records', () => {
    expect(getInvoiceJob('missing-job')).toBeUndefined()
    expect(listInvoiceJobs().map((job) => job.jobId)).not.toContain('missing-job')
  })

  test('created jobs are scoped to the browser session store', () => {
    const createdJob = createInvoiceJob('metro-upload.pdf')

    expect(listInvoiceJobs().map((job) => job.jobId)).toContain(createdJob.jobId)

    window.sessionStorage.clear()

    expect(getInvoiceJob(createdJob.jobId)).toBeUndefined()
    expect(listInvoiceJobs().map((job) => job.jobId)).not.toContain(createdJob.jobId)
  })

  test('jobs stay in review when required header fields are missing', () => {
    const createdJob = createInvoiceJob('metro-upload.pdf')

    saveInvoiceJob({
      ...createdJob,
      lineItems: createdJob.lineItems.map((item, index) => ({
        ...item,
        ingredient: index === 0 ? 'coke-330' : 'lime',
        matched: true,
      })),
      header: {
        ...createdJob.header,
        date: '2026-04-24',
      },
    })

    const storedJob = getInvoiceJob(createdJob.jobId)

    expect(storedJob?.status).toBe('needs_review')
    expect(getInvoiceReadinessSummary(storedJob!).missingHeaderFields).toEqual(
      expect.arrayContaining(['供应商', '发票号', '总金额', '税额']),
    )
  })

  test('jobs become ready only after header fields and mappings are complete', () => {
    const createdJob = createInvoiceJob('metro-upload.pdf')

    saveInvoiceJob({
      ...createdJob,
      lineItems: createdJob.lineItems.map((item, index) => ({
        ...item,
        ingredient: index === 0 ? 'coke-330' : 'lime',
        matched: true,
        unitPrice: '1.50',
      })),
      header: {
        supplier: 'Makro Madrid',
        invoiceNo: 'MK-889120',
        date: '2026-04-24',
        totalAmount: '248.90',
        taxAmount: '34.56',
        notes: '',
      },
    })

    const storedJob = getInvoiceJob(createdJob.jobId)

    expect(storedJob?.status).toBe('ready')
    expect(getInvoiceReadinessSummary(storedJob!)).toMatchObject({
      isReady: true,
      unmatchedLineItems: 0,
      missingHeaderFields: [],
      invalidHeaderFields: [],
    })
  })

  test('invalid amount formats block the ready status', () => {
    const createdJob = createInvoiceJob('metro-upload.pdf')

    saveInvoiceJob({
      ...createdJob,
      lineItems: createdJob.lineItems.map((item, index) => ({
        ...item,
        ingredient: index === 0 ? 'coke-330' : 'lime',
        matched: true,
        unitPrice: '1.50',
      })),
      header: {
        supplier: 'Makro Madrid',
        invoiceNo: 'MK-889120',
        date: '2026-04-24',
        totalAmount: '248,90',
        taxAmount: 'invalid',
        notes: '',
      },
    })

    const storedJob = getInvoiceJob(createdJob.jobId)

    expect(storedJob?.status).toBe('needs_review')
    expect(getInvoiceReadinessSummary(storedJob!).invalidHeaderFields).toEqual([
      '税额',
    ])
  })
})
