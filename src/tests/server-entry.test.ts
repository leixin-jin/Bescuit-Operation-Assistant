import { describe, expect, test, vi } from 'vitest'
import { processInvoiceIntakeQueueMessage } from '@/lib/server/extraction'
import { getInvoiceDocumentPreviewResponse } from '@/lib/server/queries/document-preview'
import type { InvoiceIntakeQueueMessage } from '@/lib/server/queue'

vi.mock('@tanstack/react-start/server-entry', () => ({
  default: {
    fetch: vi.fn(async () => new Response('app ok')),
  },
}))

vi.mock('@/lib/server/queries/document-preview', () => ({
  getInvoiceDocumentPreviewResponse: vi.fn(),
}))

vi.mock('@/lib/server/extraction', () => ({
  processInvoiceIntakeQueueMessage: vi.fn(),
}))

import server from '@/server'

const ctx = {} as ExecutionContext

function createQueueMessage(input: { attempts: number; body: unknown }) {
  return {
    id: 'message-1',
    attempts: input.attempts,
    body: input.body,
    ack: vi.fn(),
    retry: vi.fn(),
  }
}

describe('worker entry auth', () => {
  test('rejects production requests without an Authorization header', async () => {
    const env = {
      MODE: 'production',
      APP_BASIC_AUTH_USER: 'admin',
      APP_BASIC_AUTH_PASSWORD: 'secret',
    }

    const response = await server.fetch(
      new Request('https://app.example.test/'),
      env,
      ctx,
    )

    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toContain('Basic')
  })

  test('allows production requests with valid Basic credentials', async () => {
    const env = {
      MODE: 'production',
      APP_BASIC_AUTH_USER: 'admin',
      APP_BASIC_AUTH_PASSWORD: 'secret',
    }

    const response = await server.fetch(
      new Request('https://app.example.test/', {
        headers: {
          Authorization: `Basic ${btoa('admin:secret')}`,
        },
      }),
      env,
      ctx,
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('app ok')
  })

  test('keeps development requests open without auth secrets', async () => {
    const response = await server.fetch(new Request('https://app.example.test/'), {}, ctx)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('app ok')
  })

  test('fails closed when production auth credentials are not configured', async () => {
    const response = await server.fetch(
      new Request('https://app.example.test/'),
      { MODE: 'production' },
      ctx,
    )

    expect(response.status).toBe(500)
    expect(await response.text()).toBe('Application auth is not configured')
  })

  test('rejects wrong Basic credentials', async () => {
    const response = await server.fetch(
      new Request('https://app.example.test/', {
        headers: {
          Authorization: `Basic ${btoa('admin:wrong')}`,
        },
      }),
      {
        MODE: 'production',
        APP_BASIC_AUTH_USER: 'admin',
        APP_BASIC_AUTH_PASSWORD: 'secret',
      },
      ctx,
    )

    expect(response.status).toBe(401)
  })

  test('requires auth outside production when auth secrets are present', async () => {
    const response = await server.fetch(
      new Request('https://app.example.test/'),
      {
        MODE: 'development',
        APP_BASIC_AUTH_USER: 'admin',
        APP_BASIC_AUTH_PASSWORD: 'secret',
      },
      ctx,
    )

    expect(response.status).toBe(401)
  })

  test('blocks invoice document previews before preview handling', async () => {
    vi.mocked(getInvoiceDocumentPreviewResponse).mockClear()

    const response = await server.fetch(
      new Request('https://app.example.test/api/invoice-document-preview/job-1'),
      {
        MODE: 'production',
        APP_BASIC_AUTH_USER: 'admin',
        APP_BASIC_AUTH_PASSWORD: 'secret',
      },
      ctx,
    )

    expect(response.status).toBe(401)
    expect(getInvoiceDocumentPreviewResponse).not.toHaveBeenCalled()
  })

  test('accepts case-insensitive Basic scheme', async () => {
    const response = await server.fetch(
      new Request('https://app.example.test/', {
        headers: {
          Authorization: `basic ${btoa('admin:secret')}`,
        },
      }),
      {
        MODE: 'production',
        APP_BASIC_AUTH_USER: 'admin',
        APP_BASIC_AUTH_PASSWORD: 'secret',
      },
      ctx,
    )

    expect(response.status).toBe(200)
  })
})

describe('worker queue handling', () => {
  test('failed valid messages are retried instead of acked at max attempts', async () => {
    vi.mocked(processInvoiceIntakeQueueMessage).mockRejectedValueOnce(
      new Error('extractor unavailable'),
    )

    const message = createQueueMessage({
      attempts: 3,
      body: {
        jobId: 'job-queue-retry',
        sourceDocumentId: 'source-document-1',
        r2Key: 'invoice-source/source-document-1.pdf',
        fileName: 'invoice.pdf',
        mimeType: 'application/pdf',
        uploadedAt: '2026-05-21T10:00:00.000Z',
      },
    })

    await server.queue(
      {
        queue: 'bescuit-operation-assistant-intake',
        messages: [message],
      } as unknown as MessageBatch<InvoiceIntakeQueueMessage>,
      {} as Env,
    )

    expect(message.ack).not.toHaveBeenCalled()
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 60 })
  })
})
