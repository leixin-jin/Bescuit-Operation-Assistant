import handler from '@tanstack/react-start/server-entry'

export default {
  fetch: handler.fetch,
  async queue(batch) {
    for (const message of batch.messages) {
      console.warn('Unhandled queue message during Phase 1 scaffold:', message.body)
      message.ack()
    }
  },
}
