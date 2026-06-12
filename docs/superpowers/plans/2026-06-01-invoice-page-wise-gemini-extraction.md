# Page-Wise Gemini Invoice Extraction Implementation Plan

> Superseded for bundled multi-invoice PDFs by `docs/superpowers/plans/2026-06-11-fix-multi-invoice-pdf-extraction.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Gemini invoice extraction handle multi-page supplier PDFs more reliably by splitting PDFs into page-sized extraction work and merging the results into one review draft.

**Architecture:** Keep the existing queue and provider interface, but add a PDF page preprocessing layer before Gemini extraction. For PDFs with more than one page, render or split each page into a page input, ask Gemini for a smaller per-page JSON payload, then merge headers, totals, warnings, and line items into the existing `invoice-extraction-v2` draft.

**Tech Stack:** Cloudflare Workers queue consumer, TypeScript, Vitest, existing Gemini provider, existing `invoice-extraction-v2` Zod schema.

---

## File Structure

- Modify `src/lib/server/invoice-extraction/file-input.ts`: add page-aware input types and PDF input mode helpers.
- Create `src/lib/server/invoice-extraction/pdf-pages.ts`: isolate PDF page splitting/rendering decisions behind one function.
- Modify `src/lib/server/invoice-extraction/gemini-provider.ts`: add a per-page extraction path and a merge path for multi-page PDFs.
- Create `src/lib/server/invoice-extraction/merge-page-extractions.ts`: merge per-page drafts deterministically.
- Modify `src/lib/server/invoice-extraction/providers.ts`: pass page-wise options from env.
- Modify `src/lib/server/bindings.ts`: add env vars for page-wise extraction.
- Modify `README.md`: document the page-wise extraction mode and timeout guidance.
- Test `src/tests/invoice-extraction.test.ts`: cover mode selection, page merge behavior, and Gemini request fan-out.

## Design

The current system sends the full PDF bytes to Gemini once. That is simple, but expensive for Crystal Reports PDFs and other multi-page invoices because Gemini must parse the whole document and fill the full schema in one response.

The optimized flow should be:

1. Build the existing provider input from the original R2 object.
2. If `documentKind !== 'pdf'`, keep the current single-call path.
3. If the file is a PDF and page-wise mode is enabled, split it into page inputs.
4. Call Gemini once per page with a smaller schema focused on `header`, `lineItems`, `pageNumber`, `confidence`, and `warnings`.
5. Merge page results into the existing `invoice-extraction-v2` shape.
6. Persist the merged draft exactly as today, so the review UI does not need a new data contract.

## Task 1: Add Page-Wise Config

**Files:**
- Modify: `src/lib/server/bindings.ts`
- Modify: `src/lib/server/invoice-extraction/providers.ts`
- Test: `src/tests/invoice-extraction.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test near the provider selection tests:

```ts
test('passes page-wise PDF extraction config to Gemini provider', () => {
  const provider = selectInvoiceExtractionProvider({
    INVOICE_EXTRACTION_PROVIDER: 'gemini',
    INVOICE_EXTRACTION_MODEL: 'gemini-3.5-flash',
    INVOICE_EXTRACTION_TIMEOUT_MS: '180000',
    INVOICE_PDF_INPUT_MODE: 'page-wise',
    GEMINI_API_KEY: 'test-key',
  })

  expect(provider.id).toBe('gemini')
  expect(provider.model).toBe('gemini-3.5-flash')
})
```

- [ ] **Step 2: Run test to verify it fails for missing config handling**

Run:

```bash
pnpm vitest run src/tests/invoice-extraction.test.ts -t "passes page-wise PDF extraction config"
```

Expected: FAIL until `INVOICE_PDF_INPUT_MODE` is typed and passed through.

- [ ] **Step 3: Add env typing**

In `src/lib/server/bindings.ts`, include:

```ts
INVOICE_PDF_INPUT_MODE?: string
INVOICE_EXTRACTION_TIMEOUT_MS?: string
```

- [ ] **Step 4: Pass mode into Gemini provider options**

In `src/lib/server/invoice-extraction/providers.ts`, extend the Gemini provider creation:

```ts
return createGeminiInvoiceExtractionProvider({
  apiKey: env.GEMINI_API_KEY,
  model,
  baseUrl: env.GEMINI_API_BASE_URL,
  timeoutMs: parsePositiveInteger(env.INVOICE_EXTRACTION_TIMEOUT_MS) ?? 60_000,
  pdfInputMode: normalizePdfInputMode(env.INVOICE_PDF_INPUT_MODE),
})
```

Add:

```ts
function normalizePdfInputMode(value: string | undefined) {
  return value?.trim() === 'page-wise' ? 'page-wise' : 'native-pdf'
}
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm vitest run src/tests/invoice-extraction.test.ts
```

Expected: PASS.

## Task 2: Introduce PDF Page Inputs

**Files:**
- Create: `src/lib/server/invoice-extraction/pdf-pages.ts`
- Modify: `src/lib/server/invoice-extraction/file-input.ts`
- Test: `src/tests/invoice-extraction.test.ts`

- [ ] **Step 1: Write failing tests for page input shape**

Add:

```ts
test('builds page inputs for PDF page-wise extraction', async () => {
  const pages = await buildPdfPageInputs({
    fileName: 'invoice.pdf',
    mimeType: 'application/pdf',
    arrayBuffer: new TextEncoder().encode('%PDF fake').buffer,
    pages: [
      {
        pageNumber: 1,
        mimeType: 'application/pdf',
        arrayBuffer: new TextEncoder().encode('page-1').buffer,
      },
      {
        pageNumber: 2,
        mimeType: 'application/pdf',
        arrayBuffer: new TextEncoder().encode('page-2').buffer,
      },
    ],
  })

  expect(pages).toHaveLength(2)
  expect(pages[0]).toMatchObject({
    fileName: 'invoice.pdf',
    pageNumber: 1,
    mimeType: 'application/pdf',
    documentKind: 'pdf',
  })
  expect(pages[0]?.base64).toBe('cGFnZS0x')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run src/tests/invoice-extraction.test.ts -t "builds page inputs"
```

Expected: FAIL because `buildPdfPageInputs` does not exist.

- [ ] **Step 3: Add page input type**

In `file-input.ts`, add:

```ts
export interface InvoiceExtractionPageInput extends InvoiceExtractionProviderInput {
  pageNumber: number
}
```

- [ ] **Step 4: Add page input builder**

In `pdf-pages.ts`, add:

```ts
import {
  buildInvoiceProviderInput,
  type InvoiceExtractionPageInput,
} from '@/lib/server/invoice-extraction/file-input'

export async function buildPdfPageInputs(input: {
  fileName: string
  mimeType: string
  arrayBuffer: ArrayBuffer
  pages: Array<{
    pageNumber: number
    mimeType: string
    arrayBuffer: ArrayBuffer
  }>
}): Promise<InvoiceExtractionPageInput[]> {
  return Promise.all(
    input.pages.map(async (page) => ({
      ...(await buildInvoiceProviderInput({
        fileName: input.fileName,
        mimeType: page.mimeType,
        arrayBuffer: page.arrayBuffer,
      })),
      pageNumber: page.pageNumber,
    })),
  )
}
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm vitest run src/tests/invoice-extraction.test.ts
```

Expected: PASS.

## Task 3: Merge Page Extractions

**Files:**
- Create: `src/lib/server/invoice-extraction/merge-page-extractions.ts`
- Test: `src/tests/invoice-extraction.test.ts`

- [ ] **Step 1: Write failing merge test**

Add:

```ts
test('merges page extraction drafts into one invoice draft', () => {
  const draft = mergePageExtractionDrafts({
    fileName: 'invoice.pdf',
    provider: 'gemini',
    model: 'gemini-3.5-flash',
    documentKind: 'pdf',
    pageDrafts: [
      {
        pageNumber: 1,
        draft: makeExtractionDraft({
          supplier: 'Proveedor SL',
          invoiceNo: 'NFD-4494',
          totalAmount: '121.00',
          lineItems: [{ id: 'p1-1', name: 'Aceite', qty: '1', unitPrice: '60.50', lineTotal: '60.50' }],
        }),
      },
      {
        pageNumber: 2,
        draft: makeExtractionDraft({
          supplier: '',
          invoiceNo: '',
          totalAmount: '',
          lineItems: [{ id: 'p2-1', name: 'Harina', qty: '2', unitPrice: '30.25', lineTotal: '60.50' }],
        }),
      },
    ],
  })

  expect(draft.pageCount).toBe(2)
  expect(draft.header.supplier).toBe('Proveedor SL')
  expect(draft.header.invoiceNo).toBe('NFD-4494')
  expect(draft.header.totalAmount).toBe('121.00')
  expect(draft.lineItems.map((item) => item.name)).toEqual(['Aceite', 'Harina'])
  expect(new Set(draft.lineItems.map((item) => item.id)).size).toBe(2)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run src/tests/invoice-extraction.test.ts -t "merges page extraction drafts"
```

Expected: FAIL because `mergePageExtractionDrafts` does not exist.

- [ ] **Step 3: Implement deterministic merge**

Create `merge-page-extractions.ts`:

```ts
import {
  ensureUniqueInvoiceLineItemIds,
  type InvoiceHeaderDraft,
} from '@/lib/server/app-domain'
import {
  INVOICE_EXTRACTION_SCHEMA_VERSION,
  type InvoiceExtractionDraft,
} from '@/lib/server/invoice-extraction/schema'
import type { InvoiceDocumentKind } from '@/lib/server/invoice-extraction/file-input'

export function mergePageExtractionDrafts(input: {
  fileName: string
  provider: string
  model: string
  documentKind: InvoiceDocumentKind
  pageDrafts: Array<{ pageNumber: number; draft: InvoiceExtractionDraft }>
}): InvoiceExtractionDraft {
  const sortedDrafts = [...input.pageDrafts].sort((a, b) => a.pageNumber - b.pageNumber)
  const firstUsefulHeader = sortedDrafts.find(({ draft }) => hasUsefulHeader(draft.header))?.draft.header
  const lineItems = sortedDrafts.flatMap(({ pageNumber, draft }) =>
    draft.lineItems.map((item) => ({
      ...item,
      id: `p${pageNumber}-${item.id}`,
      notes: item.notes ? `Page ${pageNumber}: ${item.notes}` : item.notes,
    })),
  )

  return {
    schemaVersion: INVOICE_EXTRACTION_SCHEMA_VERSION,
    pageCount: Math.max(1, sortedDrafts.length),
    documentKind: input.documentKind,
    header: normalizeMergedHeader(firstUsefulHeader, sortedDrafts.map(({ draft }) => draft.header)),
    lineItems: ensureUniqueInvoiceLineItemIds(lineItems, input.fileName),
    markdownText: '',
    provider: input.provider,
    model: input.model,
    confidence: {
      overall: averageConfidence(sortedDrafts.map(({ draft }) => draft.confidence?.overall)),
      header: averageConfidence(sortedDrafts.map(({ draft }) => draft.confidence?.header)),
      lineItems: averageConfidence(sortedDrafts.map(({ draft }) => draft.confidence?.lineItems)),
      totals: averageConfidence(sortedDrafts.map(({ draft }) => draft.confidence?.totals)),
    },
    warnings: sortedDrafts.flatMap(({ pageNumber, draft }) =>
      (draft.warnings ?? []).map((warning) => `Page ${pageNumber}: ${warning}`),
    ),
  }
}

function hasUsefulHeader(header: InvoiceHeaderDraft) {
  return Boolean(header.supplier || header.invoiceNo || header.totalAmount)
}

function normalizeMergedHeader(
  preferred: InvoiceHeaderDraft | undefined,
  headers: InvoiceHeaderDraft[],
): InvoiceHeaderDraft {
  const source = preferred ?? headers[0]

  return {
    supplier: source?.supplier ?? '',
    supplierTaxId: source?.supplierTaxId,
    supplierAddress: source?.supplierAddress,
    customerName: source?.customerName,
    customerTaxId: source?.customerTaxId,
    customerAddress: source?.customerAddress,
    invoiceNo: source?.invoiceNo ?? '',
    date: source?.date ?? '',
    subtotalAmount: firstNonEmpty(headers.map((header) => header.subtotalAmount)) ?? '',
    taxAmount: firstNonEmpty(headers.map((header) => header.taxAmount)) ?? '',
    totalAmount: firstNonEmpty(headers.map((header) => header.totalAmount)) ?? '',
    currency: source?.currency ?? 'EUR',
    notes: source?.notes ?? '',
  }
}

function firstNonEmpty(values: Array<string | undefined>) {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)
}

function averageConfidence(values: Array<number | undefined>) {
  const numericValues = values.filter((value): value is number => typeof value === 'number')
  if (numericValues.length === 0) return 0.5
  return numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
pnpm vitest run src/tests/invoice-extraction.test.ts -t "merges page extraction drafts"
```

Expected: PASS.

## Task 4: Add Gemini Page-Wise Path

**Files:**
- Modify: `src/lib/server/invoice-extraction/gemini-provider.ts`
- Test: `src/tests/invoice-extraction.test.ts`

- [ ] **Step 1: Write failing provider fan-out test**

Add:

```ts
test('page-wise Gemini extraction sends one request per page', async () => {
  const fetchCalls: unknown[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = vi.fn(async (_url, init) => {
    fetchCalls.push(JSON.parse(String(init?.body)))
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify(makeProviderJsonResponse({
                    supplier: 'Proveedor SL',
                    invoiceNo: 'NFD-4494',
                    lineItems: [{ id: 'item-1', name: 'Aceite', qty: '1', unitPrice: '10.00', lineTotal: '10.00' }],
                  })),
                },
              ],
            },
          },
        ],
      }),
      { status: 200 },
    )
  }) as typeof fetch

  try {
    const provider = createGeminiInvoiceExtractionProvider({
      apiKey: 'test-key',
      model: 'gemini-3.5-flash',
      timeoutMs: 180000,
      pdfInputMode: 'page-wise',
      splitPdfPages: async () => [
        makeProviderInput({ base64: 'page-one' }),
        makeProviderInput({ base64: 'page-two' }),
      ],
    })

    const result = await provider.extract(makeProviderInput({ base64: 'whole-pdf' }))

    expect(fetchCalls).toHaveLength(2)
    expect(result.draft.pageCount).toBe(2)
  } finally {
    globalThis.fetch = originalFetch
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run src/tests/invoice-extraction.test.ts -t "page-wise Gemini extraction"
```

Expected: FAIL because the provider only has the single-call native PDF path.

- [ ] **Step 3: Extend provider options**

In `gemini-provider.ts`, extend `GeminiProviderOptions`:

```ts
type PdfInputMode = 'native-pdf' | 'page-wise'

interface GeminiProviderOptions {
  apiKey: string
  model: string
  baseUrl?: string
  timeoutMs: number
  pdfInputMode?: PdfInputMode
  splitPdfPages?: (input: InvoiceExtractionProviderInput) => Promise<InvoiceExtractionPageInput[]>
}
```

- [ ] **Step 4: Branch inside `extract`**

At the start of `extract(input)`, add:

```ts
if (
  input.documentKind === 'pdf' &&
  options.pdfInputMode === 'page-wise' &&
  options.splitPdfPages
) {
  return extractPageWise(options, input)
}
```

- [ ] **Step 5: Implement `extractPageWise`**

Add:

```ts
async function extractPageWise(
  options: GeminiProviderOptions,
  input: InvoiceExtractionProviderInput,
): Promise<InvoiceExtractionProviderResult> {
  const pageInputs = await options.splitPdfPages?.(input)
  if (!pageInputs || pageInputs.length <= 1) {
    return extractSingleDocument(options, input)
  }

  const pageResults = []
  for (const pageInput of pageInputs) {
    const response = await postGeminiGenerateContent(options, buildGeminiRequestBody(pageInput))
    const rawJson = extractGeminiText(response)
    pageResults.push({
      pageNumber: pageInput.pageNumber,
      draft: parseProviderExtractionResponse({
        rawJson,
        fileName: input.fileName,
        provider: 'gemini',
        model: options.model,
        documentKind: input.documentKind,
      }),
      response,
    })
  }

  return {
    draft: mergePageExtractionDrafts({
      fileName: input.fileName,
      provider: 'gemini',
      model: options.model,
      documentKind: input.documentKind,
      pageDrafts: pageResults,
    }),
    rawResponse: JSON.stringify({
      provider: 'gemini',
      model: options.model,
      pageCount: pageResults.length,
      pages: pageResults.map((result) => ({
        pageNumber: result.pageNumber,
        response: result.response,
      })),
    }),
  }
}
```

- [ ] **Step 6: Extract current single-call body into helpers**

Refactor the current body construction into:

```ts
function buildGeminiRequestBody(input: InvoiceExtractionProviderInput) {
  return {
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
      responseMimeType: 'application/json',
      responseSchema: invoiceExtractionResponseJsonSchema,
    },
  }
}
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm vitest run src/tests/invoice-extraction.test.ts
```

Expected: PASS.

## Task 5: Choose Production PDF Splitting Strategy

**Files:**
- Modify: `src/lib/server/invoice-extraction/pdf-pages.ts`
- Modify: `wrangler.jsonc`
- Modify: `README.md`
- Test: `src/tests/invoice-extraction.test.ts`

- [ ] **Step 1: Decide implementation target**

For Cloudflare Workers, do not assume Node-native PDF libraries can run in production. Use one of these concrete strategies:

- Preferred: render/split pages before upload in the browser and upload page artifacts plus the original PDF.
- Alternative: call a dedicated PDF splitting service from the queue worker.
- Temporary: keep `native-pdf` in production and use `page-wise` only in local/server environments that can run a PDF library.

- [ ] **Step 2: Implement the chosen splitter behind `splitPdfPages`**

The provider must only depend on this signature:

```ts
async function splitPdfPages(input: InvoiceExtractionProviderInput): Promise<InvoiceExtractionPageInput[]>
```

Keep all browser, service, or library-specific code inside `pdf-pages.ts`.

- [ ] **Step 3: Document operational settings**

In `README.md`, add:

```md
| `INVOICE_PDF_INPUT_MODE` | `native-pdf` or `page-wise`; `page-wise` splits multi-page PDFs into smaller Gemini extraction calls before merging. |
| `INVOICE_EXTRACTION_TIMEOUT_MS` | Use `180000` for native multi-page PDF extraction; page-wise extraction can usually use a lower per-page timeout after production data confirms latency. |
```

- [ ] **Step 4: Run build**

Run:

```bash
pnpm run build
```

Expected: PASS.

## Verification

Run these after all tasks:

```bash
pnpm vitest run src/tests/invoice-extraction.test.ts src/tests/real-data-integration.test.ts
pnpm run build
```

Then test the known problematic file `2026_NFD_4494.PDF` twice:

1. `INVOICE_PDF_INPUT_MODE=native-pdf` and `INVOICE_EXTRACTION_TIMEOUT_MS=180000`.
2. `INVOICE_PDF_INPUT_MODE=page-wise` and the same timeout.

Success criteria:

- The queue job reaches review instead of `error`.
- `lineItems` contains all visible product rows across all pages.
- Header totals match the PDF totals.
- Raw response records page count and page warnings without storing API keys.

## Rollout

1. Deploy the timeout increase first.
2. Keep `INVOICE_PDF_INPUT_MODE=native-pdf` until page-wise extraction passes local and staging tests.
3. Enable `page-wise` for one known supplier or one staging environment.
4. Compare latency, failure rate, and manual correction rate against native PDF extraction.
5. Promote `page-wise` to the default only after it improves reliability on the real invoice set.
