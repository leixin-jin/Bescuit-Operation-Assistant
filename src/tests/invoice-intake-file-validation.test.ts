import { describe, expect, test } from 'vitest'

import {
  MAX_INVOICE_UPLOAD_SIZE_BYTES,
  validateInvoiceUpload,
} from '@/features/invoices/intake-file-validation'

describe('invoice intake file validation', () => {
  test('accepts supported invoice files within the size limit', () => {
    expect(
      validateInvoiceUpload({
        name: 'invoice.pdf',
        size: 1024,
        type: 'application/pdf',
      }),
    ).toEqual({ isValid: true })

    expect(
      validateInvoiceUpload({
        name: 'invoice.HEIC',
        size: 2048,
        type: '',
      }),
    ).toEqual({ isValid: true })
  })

  test('rejects unsupported file extensions', () => {
    expect(
      validateInvoiceUpload({
        name: 'invoice.txt',
        size: 1024,
        type: 'text/plain',
      }),
    ).toMatchObject({
      isValid: false,
      errorMessage: expect.stringContaining('仅支持 PDF 或常见图片格式'),
    })
  })

  test('rejects unsupported mime types for otherwise valid names', () => {
    expect(
      validateInvoiceUpload({
        name: 'invoice.pdf',
        size: 1024,
        type: 'application/x-msdownload',
      }),
    ).toMatchObject({
      isValid: false,
      errorMessage: expect.stringContaining('文件类型不受支持'),
    })
  })

  test('rejects oversized files', () => {
    expect(
      validateInvoiceUpload({
        name: 'invoice.pdf',
        size: MAX_INVOICE_UPLOAD_SIZE_BYTES + 1,
        type: 'application/pdf',
      }),
    ).toMatchObject({
      isValid: false,
      errorMessage: expect.stringContaining('文件不能超过'),
    })
  })
})
