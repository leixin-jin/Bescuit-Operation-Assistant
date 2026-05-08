import type {
  InvoiceExtractionProvider,
  InvoiceExtractionProviderResult,
} from '@/lib/server/invoice-extraction/providers'
import {
  invoiceExtractionResponseJsonSchema,
  parseProviderExtractionResponse,
} from '@/lib/server/invoice-extraction/schema'

interface GeminiProviderOptions {
  apiKey: string
  model: string
  baseUrl?: string
  timeoutMs: number
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string
      }>
    }
    finishReason?: string
  }>
  promptFeedback?: unknown
}

export function createGeminiInvoiceExtractionProvider(
  options: GeminiProviderOptions,
): InvoiceExtractionProvider {
  return {
    id: 'gemini',
    model: options.model,
    async extract(input): Promise<InvoiceExtractionProviderResult> {
      const response = await postGeminiGenerateContent(options, {
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: input.mimeType,
                  data: input.base64,
                },
              },
              {
                text: buildInvoiceExtractionPrompt(input.fileName, input.documentKind),
              },
            ],
          },
        ],
        generationConfig: {
          responseFormat: {
            text: {
              mimeType: 'application/json',
              schema: invoiceExtractionResponseJsonSchema,
            },
          },
        },
      })
      const rawJson = extractGeminiText(response)

      return {
        draft: parseProviderExtractionResponse({
          rawJson,
          fileName: input.fileName,
          provider: 'gemini',
          model: options.model,
        }),
        rawResponse: JSON.stringify({
          provider: 'gemini',
          model: options.model,
          candidates: response.candidates?.map((candidate) => ({
            finishReason: candidate.finishReason,
            text: candidate.content?.parts
              ?.map((part) => part.text)
              .filter(Boolean)
              .join(''),
          })),
          promptFeedback: response.promptFeedback ?? null,
        }),
      }
    },
  }
}

async function postGeminiGenerateContent(
  options: GeminiProviderOptions,
  body: unknown,
) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs)

  try {
    const response = await fetch(buildGeminiGenerateContentUrl(options), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': options.apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const responseText = await response.text()

    if (!response.ok) {
      throw new Error(
        `Gemini invoice extraction failed with HTTP ${response.status}: ${truncateForError(responseText)}`,
      )
    }

    try {
      return JSON.parse(responseText) as GeminiGenerateContentResponse
    } catch {
      throw new Error('Gemini invoice extraction returned non-JSON API response')
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Gemini invoice extraction timed out after ${options.timeoutMs}ms`)
    }

    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

function buildGeminiGenerateContentUrl(options: GeminiProviderOptions) {
  const baseUrl =
    options.baseUrl?.replace(/\/+$/g, '') ||
    'https://generativelanguage.googleapis.com/v1beta'
  const encodedModel = encodeURIComponent(options.model)

  return `${baseUrl}/models/${encodedModel}:generateContent`
}

function extractGeminiText(response: GeminiGenerateContentResponse) {
  const text =
    response.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim() ?? ''

  if (!text) {
    throw new Error('Gemini invoice extraction returned an empty structured response')
  }

  return text
}

function buildInvoiceExtractionPrompt(fileName: string, documentKind: string) {
  return [
    'Extract this Spanish restaurant supplier invoice into the provided JSON schema.',
    `File name: ${fileName}`,
    `Document kind: ${documentKind}`,
    'Rules:',
    '- Return only JSON that matches the schema.',
    '- Preserve invoice line items as product rows, not accounting summaries.',
    '- Use YYYY-MM-DD dates when visible; leave uncertain fields empty.',
    '- Use dot decimal money strings, for example 12.50.',
    '- Put missing, low-confidence, or inconsistent totals in warnings.',
    '- Do not infer ingredient mappings; ingredient must be an empty string and matched must be false.',
  ].join('\n')
}

function truncateForError(value: string) {
  return value.length > 500 ? `${value.slice(0, 500)}...` : value
}
