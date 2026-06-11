import { PDFDocument } from 'pdf-lib'

import type {
  InvoiceExtractionPageInput,
  InvoiceExtractionProviderInput,
} from '@/lib/server/invoice-extraction/file-input'

export async function splitPdfIntoPageInputs(
  input: InvoiceExtractionProviderInput,
): Promise<InvoiceExtractionPageInput[]> {
  const sourcePdf = await PDFDocument.load(input.arrayBuffer)
  const pageCount = sourcePdf.getPageCount()
  const pages: InvoiceExtractionPageInput[] = []

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pagePdf = await PDFDocument.create()
    const [copiedPage] = await pagePdf.copyPages(sourcePdf, [pageIndex])
    pagePdf.addPage(copiedPage)
    const pageBytes = await pagePdf.save()
    const pageArrayBuffer = uint8ArrayToArrayBuffer(pageBytes)
    const base64 = arrayBufferToBase64(pageArrayBuffer)

    pages.push({
      ...input,
      mimeType: 'application/pdf',
      arrayBuffer: pageArrayBuffer,
      size: pageArrayBuffer.byteLength,
      base64,
      dataUrl: `data:application/pdf;base64,${base64}`,
      documentKind: 'pdf',
      pageNumber: pageIndex + 1,
    })
  }

  return pages
}

function uint8ArrayToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(arrayBuffer).set(bytes)
  return arrayBuffer
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
