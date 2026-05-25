import type { AppBindings } from '@/lib/server/bindings'
import type { InvoiceExtractionProviderInput } from '@/lib/server/invoice-extraction/file-input'
import { createGeminiInvoiceExtractionProvider } from '@/lib/server/invoice-extraction/gemini-provider'
import { createHeuristicInvoiceExtractionProvider } from '@/lib/server/invoice-extraction/heuristic-provider'
import type { InvoiceExtractionDraft } from '@/lib/server/invoice-extraction/schema'

export interface InvoiceExtractionProviderResult {
  draft: InvoiceExtractionDraft
  rawResponse: string | null
}

export interface InvoiceExtractionProvider {
  id: string
  model: string
  extract(input: InvoiceExtractionProviderInput): Promise<InvoiceExtractionProviderResult>
}

export type InvoiceExtractionProviderId = 'gemini' | 'heuristic-v1'

export function selectInvoiceExtractionProvider(
  env: Partial<AppBindings> | null | undefined,
): InvoiceExtractionProvider {
  const providerId = normalizeProviderId(env?.INVOICE_EXTRACTION_PROVIDER)
  const model =
    env?.INVOICE_EXTRACTION_MODEL?.trim() ||
    (providerId === 'gemini' ? 'gemini-3.5-flash' : 'filename-fallback-v1')

  if (providerId === 'gemini') {
    if (!env?.GEMINI_API_KEY?.trim()) {
      throw new Error('Missing GEMINI_API_KEY for Gemini invoice extraction provider')
    }

    return createGeminiInvoiceExtractionProvider({
      apiKey: env.GEMINI_API_KEY,
      model,
      baseUrl: env.GEMINI_API_BASE_URL,
      timeoutMs: parsePositiveInteger(env.INVOICE_EXTRACTION_TIMEOUT_MS) ?? 60_000,
    })
  }

  return createHeuristicInvoiceExtractionProvider({ model })
}

function normalizeProviderId(value: string | undefined): InvoiceExtractionProviderId {
  switch (value?.trim()) {
    case 'gemini':
    case 'ai-gateway-google-vision':
      return 'gemini'
    case 'heuristic-v1':
    case 'heuristic':
    case undefined:
    case '':
      return 'heuristic-v1'
    default:
      throw new Error(`Unsupported invoice extraction provider: ${value}`)
  }
}

function parsePositiveInteger(value: string | undefined) {
  if (!value) {
    return null
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}
