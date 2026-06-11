export type InvoiceDocumentKind = 'pdf' | 'image' | 'mixed' | 'unknown'

export type InvoicePdfInputMode = 'native-pdf' | 'page-wise'

export interface InvoiceExtractionProviderInput {
  fileName: string
  mimeType: string
  arrayBuffer: ArrayBuffer
  size: number
  base64: string
  dataUrl: string
  documentKind: InvoiceDocumentKind
}

export interface InvoiceExtractionPageInput extends InvoiceExtractionProviderInput {
  pageNumber: number
}

export async function buildInvoiceProviderInput(input: {
  fileName: string
  mimeType: string
  arrayBuffer: ArrayBuffer
}): Promise<InvoiceExtractionProviderInput> {
  const normalizedMimeType =
    input.mimeType.trim().toLowerCase() || inferMimeType(input.fileName)
  const base64 = arrayBufferToBase64(input.arrayBuffer)

  return {
    fileName: input.fileName,
    mimeType: normalizedMimeType,
    arrayBuffer: input.arrayBuffer,
    size: input.arrayBuffer.byteLength,
    base64,
    dataUrl: `data:${normalizedMimeType};base64,${base64}`,
    documentKind: getInvoiceDocumentKind(normalizedMimeType, input.fileName),
  }
}

function getInvoiceDocumentKind(
  mimeType: string,
  fileName: string,
): InvoiceDocumentKind {
  if (mimeType === 'application/pdf' || /\.pdf$/i.test(fileName)) {
    return 'pdf'
  }

  if (mimeType.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|tiff?|heic|heif)$/i.test(fileName)) {
    return 'image'
  }

  return 'unknown'
}

function inferMimeType(fileName: string) {
  const lowerName = fileName.toLowerCase()

  if (lowerName.endsWith('.pdf')) return 'application/pdf'
  if (lowerName.endsWith('.png')) return 'image/png'
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg'
  if (lowerName.endsWith('.webp')) return 'image/webp'
  if (lowerName.endsWith('.gif')) return 'image/gif'
  if (lowerName.endsWith('.bmp')) return 'image/bmp'
  if (lowerName.endsWith('.tif') || lowerName.endsWith('.tiff')) return 'image/tiff'
  if (lowerName.endsWith('.heic')) return 'image/heic'
  if (lowerName.endsWith('.heif')) return 'image/heif'

  return 'application/octet-stream'
}

function arrayBufferToBase64(arrayBuffer: ArrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ''
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}
