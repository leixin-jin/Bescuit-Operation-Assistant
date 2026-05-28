// @vitest-environment jsdom

import { beforeEach, describe, expect, test } from 'vitest'

import {
  createInvoiceJob,
  deleteInvoiceJob,
  getStatusLabel,
  getInvoiceJob,
  getInvoiceReadinessSummary,
  listInvoiceJobs,
  saveInvoiceJob,
} from '@/features/invoices/mock-store'

describe('invoice mock store', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  test('ready invoice jobs are labelled as booked', () => {
    expect(getStatusLabel('ready')).toBe('已入账')
  })

  test('unknown job ids do not create new records', async () => {
    expect(await getInvoiceJob('missing-job')).toBeNull()
    expect((await listInvoiceJobs()).map((job) => job.jobId)).not.toContain('missing-job')
  })

  test('created jobs are scoped to the browser session store', async () => {
    const createdJob = await createInvoiceJob('metro-upload.pdf')

    expect((await listInvoiceJobs()).map((job) => job.jobId)).toContain(createdJob.jobId)

    window.sessionStorage.clear()

    expect(await getInvoiceJob(createdJob.jobId)).toBeNull()
    expect((await listInvoiceJobs()).map((job) => job.jobId)).not.toContain(createdJob.jobId)
  })

  test('jobs stay in review when required header fields are missing', async () => {
    const createdJob = await createInvoiceJob('metro-upload.pdf')

    await saveInvoiceJob({
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

    const storedJob = await getInvoiceJob(createdJob.jobId)

    expect(storedJob?.status).toBe('needs_review')
    expect(getInvoiceReadinessSummary(storedJob!).missingHeaderFields).toEqual(
      expect.arrayContaining(['供应商', '发票号', '总金额', '税额']),
    )
  })

  test('jobs become ready after required header fields are complete', async () => {
    const createdJob = await createInvoiceJob('metro-upload.pdf')

    await saveInvoiceJob({
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

    const storedJob = await getInvoiceJob(createdJob.jobId)

    expect(storedJob?.status).toBe('ready')
    expect(getInvoiceReadinessSummary(storedJob!)).toMatchObject({
      isReady: true,
      unmatchedLineItems: 0,
      missingHeaderFields: [],
      invalidHeaderFields: [],
    })
  })

  test('invalid amount formats block the ready status', async () => {
    const createdJob = await createInvoiceJob('metro-upload.pdf')

    await saveInvoiceJob({
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

    const storedJob = await getInvoiceJob(createdJob.jobId)

    expect(storedJob?.status).toBe('needs_review')
    expect(getInvoiceReadinessSummary(storedJob!).invalidHeaderFields).toEqual([
      '税额',
    ])
  })

  test('invalid invoice dates block ready status', async () => {
    const createdJob = await createInvoiceJob('metro-upload.pdf')

    await saveInvoiceJob({
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
        date: '2026-99-99',
        totalAmount: '248.90',
        taxAmount: '34.56',
        notes: '',
      },
    })

    const storedJob = await getInvoiceJob(createdJob.jobId)

    expect(storedJob?.status).toBe('needs_review')
    expect(getInvoiceReadinessSummary(storedJob!).invalidHeaderFields).toContain(
      '发票日期',
    )
  })

  test('tax larger than total blocks ready status', async () => {
    const createdJob = await createInvoiceJob('metro-upload.pdf')

    await saveInvoiceJob({
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
        totalAmount: '20.00',
        taxAmount: '21.00',
        notes: '',
      },
    })

    const storedJob = await getInvoiceJob(createdJob.jobId)

    expect(storedJob?.status).toBe('needs_review')
    expect(getInvoiceReadinessSummary(storedJob!).invalidHeaderFields).toContain(
      '税额不能大于总金额',
    )
  })

  test('invalid line item numbers block ready status', async () => {
    const createdJob = await createInvoiceJob('metro-upload.pdf')

    await saveInvoiceJob({
      ...createdJob,
      lineItems: createdJob.lineItems.map((item, index) => ({
        ...item,
        qty: index === 0 ? '-2' : item.qty,
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

    const storedJob = await getInvoiceJob(createdJob.jobId)

    expect(storedJob?.status).toBe('needs_review')
    expect(getInvoiceReadinessSummary(storedJob!).invalidHeaderFields).toContain(
      '明细金额',
    )
  })

  test('unfinished jobs can be deleted from the browser session store', async () => {
    const createdJob = await createInvoiceJob('delete-me.pdf')

    await expect(deleteInvoiceJob(createdJob.jobId)).resolves.toEqual({
      ok: true,
      deleted: true,
    })

    expect(await getInvoiceJob(createdJob.jobId)).toBeNull()
    expect((await listInvoiceJobs()).map((job) => job.jobId)).not.toContain(
      createdJob.jobId,
    )
  })

  test('ready jobs cannot be deleted from the browser session store', async () => {
    const createdJob = await createInvoiceJob('ready.pdf')
    await saveInvoiceJob({
      ...createdJob,
      stage: 'ready',
      status: 'ready',
      header: {
        supplier: 'Makro Madrid',
        invoiceNo: 'MK-889120',
        date: '2026-04-24',
        totalAmount: '248.90',
        taxAmount: '34.56',
        notes: '',
      },
      lineItems: createdJob.lineItems.map((item) => ({
        ...item,
        ingredient: 'coke-330',
        matched: true,
        unitPrice: '1.50',
      })),
    })

    await expect(deleteInvoiceJob(createdJob.jobId)).rejects.toThrow(
      /已完成|cannot delete/i,
    )
    expect(await getInvoiceJob(createdJob.jobId)).not.toBeNull()
  })
})
