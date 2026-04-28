import handler from '@tanstack/react-start/server-entry'

import { type AppBindings } from '@/lib/server/bindings'
import { processInvoiceIntakeQueueMessage } from '@/lib/server/extraction'
import {
  isInvoiceIntakeQueueMessage,
  MAX_QUEUE_CONSUMER_ATTEMPTS,
  QUEUE_RETRY_DELAY_SECONDS,
  type InvoiceIntakeQueueMessage,
} from '@/lib/server/queue'

export default {
  fetch(request: Request, env: AppBindings, ctx: ExecutionContext) {
    const handlerOptions = {
      context: {
        env,
        ctx,
      },
    } as unknown as Parameters<typeof handler.fetch>[1]

    return handler.fetch(request, handlerOptions)
  },
  async queue(
    batch: MessageBatch<InvoiceIntakeQueueMessage>,
    env: AppBindings,
  ) {
    for (const message of batch.messages) {
      if (!isInvoiceIntakeQueueMessage(message.body)) {
        console.error('Discarding malformed intake queue message.', {
          queue: batch.queue,
          messageId: message.id,
        })
        message.ack()
        continue
      }

      try {
        await processInvoiceIntakeQueueMessage(env, message.body)
        message.ack()
      } catch (error) {
        console.error('Invoice intake queue consumer failed.', {
          queue: batch.queue,
          messageId: message.id,
          jobId: message.body.jobId,
          attempts: message.attempts,
          error: error instanceof Error ? error.message : 'Unknown queue error',
        })

        if (message.attempts >= MAX_QUEUE_CONSUMER_ATTEMPTS) {
          message.ack()
          continue
        }

        message.retry({
          delaySeconds: QUEUE_RETRY_DELAY_SECONDS,
        })
      }
    }
  },
}
