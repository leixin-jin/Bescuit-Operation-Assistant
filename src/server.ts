import handler from '@tanstack/react-start/server-entry'

import { type AppBindings } from '@/lib/server/bindings'
import { processInvoiceIntakeQueueMessage } from '@/lib/server/extraction'
import { getInvoiceDocumentPreviewResponse } from '@/lib/server/queries/document-preview'
import {
  isInvoiceIntakeQueueMessage,
  MAX_QUEUE_CONSUMER_ATTEMPTS,
  QUEUE_RETRY_DELAY_SECONDS,
  type InvoiceIntakeQueueMessage,
} from '@/lib/server/queue'

export default {
  fetch(request: Request, env: AppBindings, ctx: ExecutionContext) {
    const authResponse = requireAppBasicAuth(request, env as Partial<Env>)

    if (authResponse) {
      return authResponse
    }

    const url = new URL(request.url)
    const documentPreviewPrefix = '/api/invoice-document-preview/'

    if (url.pathname.startsWith(documentPreviewPrefix)) {
      const jobId = decodeURIComponent(url.pathname.slice(documentPreviewPrefix.length))

      if (!jobId) {
        return new Response('Missing invoice job id', { status: 400 })
      }

      return getInvoiceDocumentPreviewResponse(env, jobId)
    }

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

function requireAppBasicAuth(request: Request, env: Partial<Env>) {
  const user = env.APP_BASIC_AUTH_USER
  const password = env.APP_BASIC_AUTH_PASSWORD
  const shouldRequireAuth = env.MODE === 'production' || Boolean(user || password)

  if (!shouldRequireAuth) {
    return null
  }

  if (!user || !password) {
    return new Response('Application auth is not configured', { status: 500 })
  }

  if (request.headers.get('Authorization') === `Basic ${btoa(`${user}:${password}`)}`) {
    return null
  }

  return new Response('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Bescuit Operation Assistant"',
    },
  })
}
