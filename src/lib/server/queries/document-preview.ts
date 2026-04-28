import { createServerFn } from '@tanstack/react-start'

import { getServerEnv, requireBinding, type AppBindings } from '@/lib/server/bindings'
import { allD1, requireD1Database } from '@/lib/server/d1'

export interface InvoiceDocumentPreview {
  fileName: string
  mimeType: string
  dataUrl: string
  kind: 'image' | 'pdf' | 'unsupported'
}

interface SourceDocumentPreviewRow {
  fileName: string
  mimeType: string | null
  r2Key: string | null
}

export const getInvoiceDocumentPreviewServerFn = createServerFn({
  method: 'GET',
})
  .inputValidator((data: { jobId: string }) => data)
  .handler(async ({ data, context }) =>
    getInvoiceDocumentPreviewFromDatabase(getServerEnv(context), data.jobId),
  )

export async function getInvoiceDocumentPreviewFromDatabase(
  env: Partial<AppBindings> | null | undefined,
  jobId: string,
): Promise<InvoiceDocumentPreview> {
  const db = requireD1Database(env, 'invoice document preview')
  const rawDocumentsBucket = requireBinding(env?.RAW_DOCUMENTS, 'RAW_DOCUMENTS')
  const rows = await allD1<SourceDocumentPreviewRow>(
    db,
    `/* document-preview:get-source */
    SELECT
      source_documents.original_filename AS fileName,
      source_documents.mime_type AS mimeType,
      source_documents.r2_key AS r2Key
    FROM intake_jobs
    INNER JOIN source_documents
      ON source_documents.id = intake_jobs.source_document_id
    WHERE intake_jobs.id = ?
    LIMIT 1`,
    [jobId],
  )
  const sourceDocument = rows[0]

  if (!sourceDocument?.r2Key) {
    throw new Error(`Invoice source document not found for job: ${jobId}`)
  }

  const object = await rawDocumentsBucket.get(sourceDocument.r2Key)
  if (!object) {
    throw new Error(`Invoice source object not found: ${sourceDocument.r2Key}`)
  }

  const mimeType =
    sourceDocument.mimeType ||
    object.httpMetadata?.contentType ||
    'application/octet-stream'
  const dataUrl = `data:${mimeType};base64,${arrayBufferToBase64(
    await object.arrayBuffer(),
  )}`

  return {
    fileName: sourceDocument.fileName,
    mimeType,
    dataUrl,
    kind: getPreviewKind(mimeType),
  }
}

function getPreviewKind(mimeType: string): InvoiceDocumentPreview['kind'] {
  if (mimeType.startsWith('image/')) {
    return 'image'
  }

  if (mimeType === 'application/pdf') {
    return 'pdf'
  }

  return 'unsupported'
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}
