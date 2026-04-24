export const MAX_INVOICE_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024

export const INVOICE_UPLOAD_ACCEPT = [
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.tif',
  '.tiff',
  '.heic',
  '.heif',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/tiff',
  'image/heic',
  'image/heif',
].join(',')

const allowedInvoiceExtensions = new Set([
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.tif',
  '.tiff',
  '.heic',
  '.heif',
])

const allowedInvoiceMimeTypes = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/tiff',
  'image/heic',
  'image/heif',
])

interface InvoiceUploadCandidate {
  name: string
  size: number
  type: string
}

interface InvoiceUploadValidationResult {
  isValid: boolean
  errorMessage?: string
}

export function validateInvoiceUpload(
  file: InvoiceUploadCandidate,
): InvoiceUploadValidationResult {
  if (file.name.trim() === '') {
    return {
      isValid: false,
      errorMessage: '文件名为空，请重新选择发票文件。',
    }
  }

  if (file.size <= 0) {
    return {
      isValid: false,
      errorMessage: '文件内容为空，请重新选择发票文件。',
    }
  }

  if (file.size > MAX_INVOICE_UPLOAD_SIZE_BYTES) {
    return {
      isValid: false,
      errorMessage: `文件不能超过 ${formatInvoiceUploadLimit(MAX_INVOICE_UPLOAD_SIZE_BYTES)}。`,
    }
  }

  const fileExtension = getFileExtension(file.name)
  if (!allowedInvoiceExtensions.has(fileExtension)) {
    return {
      isValid: false,
      errorMessage: '仅支持 PDF 或常见图片格式（JPG、PNG、WEBP、HEIC 等）。',
    }
  }

  const normalizedMimeType = file.type.trim().toLowerCase()
  if (
    normalizedMimeType !== '' &&
    !allowedInvoiceMimeTypes.has(normalizedMimeType)
  ) {
    return {
      isValid: false,
      errorMessage: '文件类型不受支持，请上传 PDF 或图片原件。',
    }
  }

  return { isValid: true }
}

export function formatInvoiceUploadLimit(byteSize: number) {
  return `${Math.round(byteSize / 1024 / 1024)} MB`
}

function getFileExtension(fileName: string) {
  const extensionIndex = fileName.lastIndexOf('.')
  return extensionIndex === -1 ? '' : fileName.slice(extensionIndex).toLowerCase()
}
