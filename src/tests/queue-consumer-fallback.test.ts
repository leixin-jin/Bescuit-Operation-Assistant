import { describe, expect, test, vi } from 'vitest'

import {
  QUEUE_RETRY_DELAY_SECONDS,
  retryUnhandledQueueBatch,
} from '@/lib/queue-consumer-fallback'

describe('retryUnhandledQueueBatch', () => {
  test('retries the whole batch without logging message bodies', async () => {
    const retryAll = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await retryUnhandledQueueBatch({
      queue: 'invoice-intake',
      metadata: {
        metrics: {
          backlogCount: 1,
          backlogBytes: 128,
        },
      },
      messages: [
        {
          id: 'message-1',
          timestamp: new Date('2026-04-23T00:00:00.000Z'),
          body: {
            invoiceNumber: 'INV-001',
            secret: 'super-secret-payload',
          },
          attempts: 2,
          retry: vi.fn(),
          ack: vi.fn(),
        },
      ],
      retryAll,
      ackAll: vi.fn(),
    })

    expect(retryAll).toHaveBeenCalledWith({
      delaySeconds: QUEUE_RETRY_DELAY_SECONDS,
    })
    expect(consoleError).toHaveBeenCalledOnce()
    expect(JSON.stringify(consoleError.mock.calls[0])).not.toContain(
      'super-secret-payload',
    )
  })
})
