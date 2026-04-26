import { requireBinding, type AppBindings } from '@/lib/server/bindings'

export const QUEUE_RETRY_DELAY_SECONDS = 60
export const MAX_QUEUE_CONSUMER_ATTEMPTS = 3

export interface InvoiceIntakeQueueMessage {
  jobId: string
  sourceDocumentId: string
  r2Key: string
  fileName: string
  mimeType: string
  uploadedAt: string
}

export async function enqueueInvoiceIntakeJob(
  env: AppBindings,
  message: InvoiceIntakeQueueMessage,
) {
  const queue = requireBinding(env.INTAKE_QUEUE, 'INTAKE_QUEUE')
  await queue.send(message)
}

export function isInvoiceIntakeQueueMessage(
  value: unknown,
): value is InvoiceIntakeQueueMessage {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.jobId === 'string' &&
    typeof candidate.sourceDocumentId === 'string' &&
    typeof candidate.r2Key === 'string' &&
    typeof candidate.fileName === 'string' &&
    typeof candidate.mimeType === 'string' &&
    typeof candidate.uploadedAt === 'string'
  )
}
