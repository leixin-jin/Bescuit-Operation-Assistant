import handler from '@tanstack/react-start/server-entry'

import { retryUnhandledQueueBatch } from '@/lib/queue-consumer-fallback'

export default {
  fetch: handler.fetch,
  queue: retryUnhandledQueueBatch,
}
