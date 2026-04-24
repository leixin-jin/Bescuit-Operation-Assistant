export const QUEUE_RETRY_DELAY_SECONDS = 60

interface QueueConsumerMessage {
  id: string
  attempts: number
  [key: string]: unknown
}

interface QueueConsumerBatch {
  queue: string
  metadata: {
    metrics: {
      backlogCount: number
      [key: string]: unknown
    }
  }
  messages: readonly QueueConsumerMessage[]
  retryAll: (options?: { delaySeconds?: number }) => void
  [key: string]: unknown
}

export async function retryUnhandledQueueBatch(batch: QueueConsumerBatch) {
  console.error('Invoice queue consumer is not implemented; retrying batch.', {
    queue: batch.queue,
    messageCount: batch.messages.length,
    backlogCount: batch.metadata.metrics.backlogCount,
    messageIds: batch.messages.map((message) => message.id),
    attempts: batch.messages.map((message) => message.attempts),
  })

  // Keep messages retryable until a real consumer or DLQ policy is wired in.
  batch.retryAll({ delaySeconds: QUEUE_RETRY_DELAY_SECONDS })
}
