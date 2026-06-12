# Multi-Invoice PDF Extraction Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix supplier PDFs like `2605A008462-2605A008463.PDF` so every page/invoice is extracted instead of only the first page.

**Architecture:** Add a page-aware extraction layer before the Gemini provider returns a review draft. When a PDF contains multiple independent invoice numbers, split the extraction into separate invoice drafts and create sibling intake jobs for each additional invoice; when pages belong to one invoice, merge page line items into one draft. Keep the review UI contract unchanged: each review job still reads one `invoice-extraction-v2` structured JSON payload.

**Tech Stack:** TypeScript, Cloudflare Workers, D1, R2, Queue, Gemini `generateContent`, Vitest, existing `invoice-extraction-v2` schema.

---

## Current Failure

The current code path in `src/lib/server/invoice-extraction/gemini-provider.ts` sends the whole PDF as one `inline_data` part and asks Gemini for one JSON response. The sample file has two real PDF pages with text layers:

- Page 1 invoice number: `2605A008462`, total: `769.22 EUR`.
- Page 2 invoice number: `2605A008463`, total: `733.15 EUR`.

Because the provider returns exactly one draft, Gemini can legally produce only the first invoice and the queue persists only that draft. This is not a PDF text extraction problem; it is a document-boundary problem.

## File Structure

- Modify `src/lib/server/invoice-extraction/file-input.ts`: add page-level provider input type.
- Create `src/lib/server/invoice-extraction/pdf-page-plan.ts`: decide whether a PDF should use native single-call extraction or page-wise extraction.
- Create `src/lib/server/invoice-extraction/page-draft-classifier.ts`: classify page drafts as one merged invoice or multiple independent invoices.
- Create `src/lib/server/invoice-extraction/merge-page-drafts.ts`: merge page drafts for one invoice and build stable sibling drafts for multiple invoices.
- Modify `src/lib/server/invoice-extraction/gemini-provider.ts`: support page-wise extraction behind `INVOICE_PDF_INPUT_MODE=page-wise`.
- Modify `src/lib/server/invoice-extraction/providers.ts`: pass PDF mode and page extraction options into Gemini.
- Modify `src/lib/server/extraction.ts`: persist the primary draft and create sibling intake jobs/extraction results for additional invoices from the same source PDF.
- Modify `src/lib/server/mutations/invoices.rpc.ts`: reuse the same page-aware persistence helper for manual retry/re-extract.
- Test `src/tests/invoice-extraction.test.ts`: provider and merge behavior.
- Test `src/tests/real-data-integration.test.ts`: queue persistence creates two review jobs for a two-invoice PDF.
- Modify `README.md` and `wrangler.jsonc`: document and enable the mode after tests pass.

## Design Decisions

1. Do not fix this with prompt text alone. The current single-response contract is the root problem.
2. Do not change review UI data shape. Create multiple review jobs when one uploaded PDF contains multiple invoices.
3. Keep one uploaded `source_documents` row. Additional intake jobs should point to the same `source_document_id`, so deleting the source still has one physical R2 object.
4. Use deterministic IDs for sibling jobs and extraction results:
   - Primary job keeps the original `jobId`.
   - Extra page job IDs use `${originalJobId}_p${pageNumber}`.
   - Extraction result IDs continue to use `getExtractionResultId(jobId)`.
5. Use `INVOICE_PDF_INPUT_MODE=page-wise` as an opt-in feature until verified with real supplier PDFs.

## Task 1: Add Page-Aware Types and Mode Parsing

**Files:**
- Modify: `src/lib/server/invoice-extraction/file-input.ts`
- Modify: `src/lib/server/invoice-extraction/providers.ts`
- Test: `src/tests/invoice-extraction.test.ts`

- [ ] **Step 1: Write the failing mode test**

Add this test inside `describe('invoice extraction helpers', ...)`:

```ts
test('selects Gemini provider with page-wise PDF mode enabled', () => {
  const provider = selectInvoiceExtractionProvider({
    INVOICE_EXTRACTION_PROVIDER: 'gemini',
    INVOICE_EXTRACTION_MODEL: 'gemini-3.5-flash',
    INVOICE_PDF_INPUT_MODE: 'page-wise',
    GEMINI_API_KEY: 'test-key',
  })

  expect(provider.id).toBe('gemini')
  expect(provider.model).toBe('gemini-3.5-flash')
})
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm vitest run src/tests/invoice-extraction.test.ts -t "selects Gemini provider with page-wise PDF mode enabled"
```

Expected: FAIL until the provider accepts a typed PDF mode option.

- [ ] **Step 3: Add page input types**

In `src/lib/server/invoice-extraction/file-input.ts`, add:

```ts
export type InvoicePdfInputMode = 'native-pdf' | 'page-wise'

export interface InvoiceExtractionPageInput extends InvoiceExtractionProviderInput {
  pageNumber: number
}
```

- [ ] **Step 4: Parse mode in provider selection**

In `src/lib/server/invoice-extraction/providers.ts`, import `InvoicePdfInputMode` and add:

```ts
function normalizePdfInputMode(value: string | undefined): InvoicePdfInputMode {
  return value?.trim() === 'page-wise' ? 'page-wise' : 'native-pdf'
}
```

Pass the option into Gemini:

```ts
return createGeminiInvoiceExtractionProvider({
  apiKey: env.GEMINI_API_KEY,
  model,
  baseUrl: env.GEMINI_API_BASE_URL,
  timeoutMs: parsePositiveInteger(env.INVOICE_EXTRACTION_TIMEOUT_MS) ?? 60_000,
  pdfInputMode: normalizePdfInputMode(env.INVOICE_PDF_INPUT_MODE),
})
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm vitest run src/tests/invoice-extraction.test.ts -t "selects Gemini provider"
```

Expected: PASS.

## Task 2: Make Gemini Extract PDF Pages Separately

**Files:**
- Create: `src/lib/server/invoice-extraction/pdf-page-plan.ts`
- Modify: `src/lib/server/invoice-extraction/gemini-provider.ts`
- Test: `src/tests/invoice-extraction.test.ts`

- [ ] **Step 1: Write the failing request fan-out test**

Add:

```ts
test('page-wise Gemini extraction sends one request per PDF page input', async () => {
  const responseFor = (invoiceNo: string, totalAmount: string, pageNumber: number) => ({
    schemaVersion: 'invoice-extraction-v2',
    pageCount: 1,
    documentKind: 'pdf',
    sourcePages: [{ pageNumber, kind: 'pdf-page' }],
    header: {
      supplier: 'Emcadi S.A.',
      invoiceNo,
      date: '2026-05-31',
      subtotalAmount: '',
      taxAmount: '',
      totalAmount,
      currency: 'EUR',
      notes: '',
    },
    lineItems: [
      {
        id: `item-${pageNumber}`,
        name: `Page ${pageNumber} item`,
        qty: '1',
        unit: 'ud',
        unitPrice: totalAmount,
        lineTotal: totalAmount,
        ingredient: '',
        matched: false,
      },
    ],
    confidence: { overall: 0.9, header: 0.9, lineItems: 0.9, totals: 0.9 },
    warnings: [],
  })

  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(responseFor('2605A008462', '769.22', 1)) }] } }],
      })),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(responseFor('2605A008463', '733.15', 2)) }] } }],
      })),
    )

  vi.stubGlobal('fetch', fetchMock)

  try {
    const provider = createGeminiInvoiceExtractionProvider({
      apiKey: 'test-key',
      model: 'gemini-3.5-flash',
      timeoutMs: 1000,
      pdfInputMode: 'page-wise',
      splitPdfPages: async () => [
        {
          fileName: '2605A008462-2605A008463.PDF',
          mimeType: 'application/pdf',
          arrayBuffer: new TextEncoder().encode('page-1').buffer,
          size: 6,
          base64: 'cGFnZS0x',
          dataUrl: 'data:application/pdf;base64,cGFnZS0x',
          documentKind: 'pdf',
          pageNumber: 1,
        },
        {
          fileName: '2605A008462-2605A008463.PDF',
          mimeType: 'application/pdf',
          arrayBuffer: new TextEncoder().encode('page-2').buffer,
          size: 6,
          base64: 'cGFnZS0y',
          dataUrl: 'data:application/pdf;base64,cGFnZS0y',
          documentKind: 'pdf',
          pageNumber: 2,
        },
      ],
    })

    const result = await provider.extract({
      fileName: '2605A008462-2605A008463.PDF',
      mimeType: 'application/pdf',
      arrayBuffer: new TextEncoder().encode('whole-pdf').buffer,
      size: 9,
      base64: 'd2hvbGUtcGRm',
      dataUrl: 'data:application/pdf;base64,d2hvbGUtcGRm',
      documentKind: 'pdf',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.draft.header.invoiceNo).toBe('2605A008462')
    expect(result.additionalDrafts).toHaveLength(1)
    expect(result.additionalDrafts?.[0]?.draft.header.invoiceNo).toBe('2605A008463')
  } finally {
    vi.unstubAllGlobals()
  }
})
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm vitest run src/tests/invoice-extraction.test.ts -t "page-wise Gemini extraction sends one request per PDF page input"
```

Expected: FAIL because `pdfInputMode`, `splitPdfPages`, and `additionalDrafts` do not exist yet.

- [ ] **Step 3: Extend provider result**

In `src/lib/server/invoice-extraction/providers.ts`, change the result interface:

```ts
export interface InvoiceExtractionProviderResult {
  draft: InvoiceExtractionDraft
  rawResponse: string | null
  additionalDrafts?: Array<{
    pageNumber: number
    draft: InvoiceExtractionDraft
    rawResponse: string | null
  }>
}
```

- [ ] **Step 4: Add Gemini options**

In `src/lib/server/invoice-extraction/gemini-provider.ts`, extend `GeminiProviderOptions`:

```ts
import type {
  InvoiceExtractionPageInput,
  InvoiceExtractionProviderInput,
  InvoicePdfInputMode,
} from '@/lib/server/invoice-extraction/file-input'

interface GeminiProviderOptions {
  apiKey: string
  model: string
  baseUrl?: string
  timeoutMs: number
  pdfInputMode?: InvoicePdfInputMode
  splitPdfPages?: (
    input: InvoiceExtractionProviderInput,
  ) => Promise<InvoiceExtractionPageInput[]>
}
```

- [ ] **Step 5: Split page-wise PDF path from native path**

Inside `extract(input)`, before the current native request, add:

```ts
if (
  input.documentKind === 'pdf' &&
  options.pdfInputMode === 'page-wise' &&
  options.splitPdfPages
) {
  return extractPageWisePdf(options, input)
}
```

Add helper:

```ts
async function extractPageWisePdf(
  options: GeminiProviderOptions,
  input: InvoiceExtractionProviderInput,
): Promise<InvoiceExtractionProviderResult> {
  const pageInputs = await options.splitPdfPages?.(input)

  if (!pageInputs || pageInputs.length <= 1) {
    return extractSingleInput(options, input)
  }

  const pageResults = []

  for (const pageInput of pageInputs) {
    const response = await requestGeminiExtraction(options, pageInput)
    pageResults.push({
      pageNumber: pageInput.pageNumber,
      draft: response.draft,
      rawResponse: response.rawResponse,
    })
  }

  return splitPageDraftsIntoProviderResult(pageResults)
}
```

Move the existing request body logic into `extractSingleInput` / `requestGeminiExtraction`. Implement `splitPageDraftsIntoProviderResult` in Task 3.

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm vitest run src/tests/invoice-extraction.test.ts -t "page-wise Gemini extraction sends one request per PDF page input"
```

Expected: still FAIL until Task 3 provides classification and splitting.

## Task 3: Classify One Invoice vs Multiple Invoices

**Files:**
- Create: `src/lib/server/invoice-extraction/page-draft-classifier.ts`
- Create: `src/lib/server/invoice-extraction/merge-page-drafts.ts`
- Modify: `src/lib/server/invoice-extraction/gemini-provider.ts`
- Test: `src/tests/invoice-extraction.test.ts`

- [ ] **Step 1: Write classifier tests**

Add:

```ts
test('classifies page drafts with different invoice numbers as separate invoices', () => {
  const result = classifyPageDrafts([
    { pageNumber: 1, draft: makeDraft({ invoiceNo: '2605A008462', totalAmount: '769.22' }), rawResponse: '{}' },
    { pageNumber: 2, draft: makeDraft({ invoiceNo: '2605A008463', totalAmount: '733.15' }), rawResponse: '{}' },
  ])

  expect(result.kind).toBe('multiple-invoices')
})

test('classifies page drafts with the same invoice number as one invoice', () => {
  const result = classifyPageDrafts([
    { pageNumber: 1, draft: makeDraft({ invoiceNo: 'F-100', totalAmount: '' }), rawResponse: '{}' },
    { pageNumber: 2, draft: makeDraft({ invoiceNo: 'F-100', totalAmount: '120.00' }), rawResponse: '{}' },
  ])

  expect(result.kind).toBe('single-invoice')
})
```

Add this local helper near the tests:

```ts
function makeDraft(input: { invoiceNo: string; totalAmount: string }): InvoiceExtractionDraft {
  return {
    schemaVersion: 'invoice-extraction-v2',
    pageCount: 1,
    documentKind: 'pdf',
    header: {
      supplier: 'Emcadi S.A.',
      invoiceNo: input.invoiceNo,
      date: '2026-05-31',
      subtotalAmount: '',
      taxAmount: '',
      totalAmount: input.totalAmount,
      currency: 'EUR',
      notes: '',
    },
    lineItems: [],
    confidence: { overall: 0.9, header: 0.9, lineItems: 0.9, totals: 0.9 },
    warnings: [],
    provider: 'gemini',
    model: 'gemini-3.5-flash',
  }
}
```

- [ ] **Step 2: Run classifier tests**

Run:

```bash
pnpm vitest run src/tests/invoice-extraction.test.ts -t "classifies page drafts"
```

Expected: FAIL because classifier does not exist.

- [ ] **Step 3: Implement classifier**

Create `src/lib/server/invoice-extraction/page-draft-classifier.ts`:

```ts
import type { InvoiceExtractionDraft } from '@/lib/server/invoice-extraction/schema'

export interface PageDraftResult {
  pageNumber: number
  draft: InvoiceExtractionDraft
  rawResponse: string | null
}

export type PageDraftClassification =
  | { kind: 'single-invoice'; pages: PageDraftResult[] }
  | { kind: 'multiple-invoices'; pages: PageDraftResult[] }

export function classifyPageDrafts(
  pages: PageDraftResult[],
): PageDraftClassification {
  const invoiceNumbers = new Set(
    pages
      .map((page) => page.draft.header.invoiceNo.trim())
      .filter((invoiceNo) => invoiceNo.length > 0),
  )

  return {
    kind: invoiceNumbers.size > 1 ? 'multiple-invoices' : 'single-invoice',
    pages,
  }
}
```

- [ ] **Step 4: Implement split/merge result builder**

Create `src/lib/server/invoice-extraction/merge-page-drafts.ts`:

```ts
import type { InvoiceExtractionProviderResult } from '@/lib/server/invoice-extraction/providers'
import type { InvoiceExtractionDraft } from '@/lib/server/invoice-extraction/schema'
import {
  classifyPageDrafts,
  type PageDraftResult,
} from '@/lib/server/invoice-extraction/page-draft-classifier'

export function splitPageDraftsIntoProviderResult(
  pages: PageDraftResult[],
): InvoiceExtractionProviderResult {
  const classification = classifyPageDrafts(pages)

  if (classification.kind === 'multiple-invoices') {
    const [primary, ...additional] = classification.pages
    if (!primary) {
      throw new Error('Page-wise invoice extraction returned no page drafts')
    }

    return {
      draft: primary.draft,
      rawResponse: primary.rawResponse,
      additionalDrafts: additional.map((page) => ({
        pageNumber: page.pageNumber,
        draft: page.draft,
        rawResponse: page.rawResponse,
      })),
    }
  }

  return mergeSingleInvoicePages(classification.pages)
}

function mergeSingleInvoicePages(pages: PageDraftResult[]): InvoiceExtractionProviderResult {
  const [first] = pages
  if (!first) {
    throw new Error('Page-wise invoice extraction returned no page drafts')
  }

  const allLineItems = pages.flatMap((page) => page.draft.lineItems)
  const warnings = pages.flatMap((page) => page.draft.warnings ?? [])
  const lastDraftWithTotal =
    [...pages].reverse().find((page) => page.draft.header.totalAmount.trim())?.draft ??
    first.draft

  const merged: InvoiceExtractionDraft = {
    ...first.draft,
    pageCount: pages.length,
    sourcePages: pages.map((page) => ({ pageNumber: page.pageNumber, kind: 'pdf-page' })),
    header: {
      ...first.draft.header,
      subtotalAmount: lastDraftWithTotal.header.subtotalAmount,
      taxAmount: lastDraftWithTotal.header.taxAmount,
      totalAmount: lastDraftWithTotal.header.totalAmount,
      currency: lastDraftWithTotal.header.currency || first.draft.header.currency,
    },
    lineItems: allLineItems,
    warnings,
  }

  return {
    draft: merged,
    rawResponse: JSON.stringify({
      pageWise: true,
      pages: pages.map((page) => ({
        pageNumber: page.pageNumber,
        rawResponse: page.rawResponse,
      })),
    }),
  }
}
```

- [ ] **Step 5: Wire merge into Gemini provider**

In `src/lib/server/invoice-extraction/gemini-provider.ts`, import:

```ts
import { splitPageDraftsIntoProviderResult } from '@/lib/server/invoice-extraction/merge-page-drafts'
```

Use it in `extractPageWisePdf`.

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm vitest run src/tests/invoice-extraction.test.ts -t "page-wise Gemini extraction|classifies page drafts"
```

Expected: PASS.

## Task 4: Persist Additional Invoice Drafts as Sibling Intake Jobs

**Files:**
- Modify: `src/lib/server/extraction.ts`
- Modify: `src/lib/server/mutations/invoices.rpc.ts`
- Test: `src/tests/real-data-integration.test.ts`

- [ ] **Step 1: Write integration test for queue persistence**

Add a test that stubs a provider result with one primary draft and one additional draft:

```ts
test('queue extraction creates sibling review jobs for multiple invoices in one PDF', async () => {
  const env = createRealDataTestEnv()
  const sourceDocumentId = 'src-multi-invoice-pdf'
  const jobId = 'job-multi-invoice-pdf'
  const r2Key = 'raw-documents/2026/05/2605A008462-2605A008463.PDF'

  await seedSourceDocumentAndJob(env, {
    sourceDocumentId,
    jobId,
    r2Key,
    fileName: '2605A008462-2605A008463.PDF',
    mimeType: 'application/pdf',
    body: '%PDF fake multi invoice',
  })

  vi.spyOn(extractionProviders, 'selectInvoiceExtractionProvider').mockReturnValue({
    id: 'gemini',
    model: 'gemini-3.5-flash',
    extract: async () => ({
      draft: makeDraft({ invoiceNo: '2605A008462', totalAmount: '769.22' }),
      rawResponse: '{"page":1}',
      additionalDrafts: [
        {
          pageNumber: 2,
          draft: makeDraft({ invoiceNo: '2605A008463', totalAmount: '733.15' }),
          rawResponse: '{"page":2}',
        },
      ],
    }),
  })

  await processInvoiceIntakeQueueMessage(env, {
    jobId,
    sourceDocumentId,
    r2Key,
    fileName: '2605A008462-2605A008463.PDF',
    mimeType: 'application/pdf',
  })

  const jobs = await env.DB.prepare(
    `SELECT id, stage FROM intake_jobs WHERE source_document_id = ? ORDER BY id`,
  ).bind(sourceDocumentId).all<{ id: string; stage: string }>()

  expect(jobs.results.map((job) => job.id)).toEqual([
    'job-multi-invoice-pdf',
    'job-multi-invoice-pdf_p2',
  ])
  expect(jobs.results.every((job) => job.stage === 'needs_review')).toBe(true)
})
```

Adjust helper names to match existing `real-data-integration.test.ts` utilities instead of duplicating setup.

- [ ] **Step 2: Run the failing integration test**

Run:

```bash
pnpm vitest run src/tests/real-data-integration.test.ts -t "sibling review jobs"
```

Expected: FAIL because additional drafts are ignored.

- [ ] **Step 3: Add persistence helper**

In `src/lib/server/extraction.ts`, add:

```ts
async function persistAdditionalExtractionDrafts(input: {
  db: NonNullable<ReturnType<typeof getDb>>
  originalJobId: string
  sourceDocumentId: string
  providerId: string
  providerModel: string
  additionalDrafts: NonNullable<InvoiceExtractionProviderResult['additionalDrafts']>
  createdAt: string
}) {
  for (const additional of input.additionalDrafts) {
    const siblingJobId = `${input.originalJobId}_p${additional.pageNumber}`
    const draft = withPriceTrackingDefaults(additional.draft)
    const schemaVersion = draft.schemaVersion ?? INVOICE_EXTRACTION_SCHEMA_VERSION

    await input.db.$client.prepare(
      `/* invoice:queue-create-sibling-job */
      INSERT INTO intake_jobs (
        id,
        source_document_id,
        stage,
        extractor_provider,
        extractor_model,
        confidence_score,
        error_message,
        created_at,
        updated_at
      )
      VALUES (?, ?, 'needs_review', ?, ?, ?, NULL, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        stage = 'needs_review',
        extractor_provider = excluded.extractor_provider,
        extractor_model = excluded.extractor_model,
        confidence_score = excluded.confidence_score,
        error_message = NULL,
        updated_at = excluded.updated_at`,
    )
      .bind(
        siblingJobId,
        input.sourceDocumentId,
        input.providerId,
        input.providerModel,
        calculateDraftConfidence(draft),
        input.createdAt,
        input.createdAt,
      )
      .run()

    await input.db.$client.prepare(
      `/* invoice:queue-upsert-sibling-extraction */
      INSERT INTO extraction_results (
        id,
        intake_job_id,
        markdown_text,
        structured_json,
        raw_response,
        schema_version,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        markdown_text = excluded.markdown_text,
        structured_json = excluded.structured_json,
        raw_response = excluded.raw_response,
        schema_version = excluded.schema_version,
        created_at = excluded.created_at`,
    )
      .bind(
        getExtractionResultId(siblingJobId),
        siblingJobId,
        draft.markdownText,
        serializeExtractionDraft(draft),
        additional.rawResponse,
        schemaVersion,
        input.createdAt,
      )
      .run()
  }
}
```

- [ ] **Step 4: Call helper after primary extraction is stored**

After the primary `extraction_results` upsert succeeds and before marking the source document processed, call:

```ts
if (extraction.additionalDrafts?.length) {
  await persistAdditionalExtractionDrafts({
    db,
    originalJobId: message.jobId,
    sourceDocumentId: message.sourceDocumentId,
    providerId: provider.id,
    providerModel: provider.model,
    additionalDrafts: extraction.additionalDrafts,
    createdAt: extractionStoredAt,
  })
}
```

- [ ] **Step 5: Apply the same helper in manual retry/re-extract**

In `src/lib/server/mutations/invoices.rpc.ts`, locate the retry path that calls `provider.extract(providerInput)`. After it stores the primary extraction result, call the shared persistence helper with the same arguments. If the helper is not exported yet, export it from `src/lib/server/extraction.ts` as:

```ts
export async function persistAdditionalInvoiceExtractionDrafts(...) { ... }
```

Use that exported function in both queue and manual retry paths.

- [ ] **Step 6: Run integration test**

Run:

```bash
pnpm vitest run src/tests/real-data-integration.test.ts -t "sibling review jobs"
```

Expected: PASS.

## Task 5: Add a Real Sample Regression Fixture

**Files:**
- Create: `src/tests/fixtures/invoices/2605A008462-2605A008463.txt`
- Test: `src/tests/invoice-extraction.test.ts`

- [ ] **Step 1: Create text fixture from verified PDF facts**

Create `src/tests/fixtures/invoices/2605A008462-2605A008463.txt`:

```txt
PAGE 1
FACTURA: 2605A008462
FECHA: 31/05/2026
TOTAL: 769.22 EUR

PAGE 2
FACTURA: 2605A008463
FECHA: 31/05/2026
TOTAL: 733.15 EUR
```

- [ ] **Step 2: Add regression test**

Add:

```ts
test('regression: 2605A008462-2605A008463 is treated as two invoices', () => {
  const pages = [
    { pageNumber: 1, draft: makeDraft({ invoiceNo: '2605A008462', totalAmount: '769.22' }), rawResponse: '{"page":1}' },
    { pageNumber: 2, draft: makeDraft({ invoiceNo: '2605A008463', totalAmount: '733.15' }), rawResponse: '{"page":2}' },
  ]

  const result = splitPageDraftsIntoProviderResult(pages)

  expect(result.draft.header.invoiceNo).toBe('2605A008462')
  expect(result.draft.header.totalAmount).toBe('769.22')
  expect(result.additionalDrafts?.[0]?.draft.header.invoiceNo).toBe('2605A008463')
  expect(result.additionalDrafts?.[0]?.draft.header.totalAmount).toBe('733.15')
})
```

- [ ] **Step 3: Run regression test**

Run:

```bash
pnpm vitest run src/tests/invoice-extraction.test.ts -t "2605A008462"
```

Expected: PASS.

## Task 6: Enable and Document Page-Wise Mode

**Files:**
- Modify: `wrangler.jsonc`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-06-01-invoice-page-wise-gemini-extraction.md`

- [ ] **Step 1: Switch deployment config after tests pass**

In `wrangler.jsonc`, change:

```json
"INVOICE_PDF_INPUT_MODE": "native-pdf"
```

to:

```json
"INVOICE_PDF_INPUT_MODE": "page-wise"
```

- [ ] **Step 2: Update README config table**

Replace the `INVOICE_PDF_INPUT_MODE` row with:

```md
| `INVOICE_PDF_INPUT_MODE` | `page-wise` sends each PDF page to Gemini separately and creates sibling review jobs when pages contain different invoice numbers. Use `native-pdf` only as a rollback mode. |
```

Add rollback note:

```md
If page-wise PDF extraction causes provider latency or cost issues, set `INVOICE_PDF_INPUT_MODE=native-pdf` to restore the previous single-call behavior. This rollback may again miss later invoices in bundled PDFs.
```

- [ ] **Step 3: Mark old plan superseded**

At the top of `docs/superpowers/plans/2026-06-01-invoice-page-wise-gemini-extraction.md`, add:

```md
> Superseded for bundled multi-invoice PDFs by `docs/superpowers/plans/2026-06-11-fix-multi-invoice-pdf-extraction.md`.
```

- [ ] **Step 4: Run config/doc checks**

Run:

```bash
pnpm vitest run src/tests/build-artifact-safety.test.ts
```

Expected: PASS.

## Task 7: Full Verification

**Files:**
- No code changes unless verification exposes failures.

- [ ] **Step 1: Run extraction tests**

Run:

```bash
pnpm vitest run src/tests/invoice-extraction.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run integration tests touching intake/extraction**

Run:

```bash
pnpm vitest run src/tests/real-data-integration.test.ts src/tests/invoice-review-rehydration.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 4: Manual production-like check**

Upload `/Users/zhuyuxia/Downloads/2605A008462-2605A008463.PDF` through `/invoices/new`.

Expected:

- The recent task list shows two reviewable jobs for the same source PDF.
- One review job has invoice number `2605A008462` and total `769.22`.
- One review job has invoice number `2605A008463` and total `733.15`.
- Both jobs keep the original PDF preview available.

## Rollback

If the page-wise implementation causes unexpected production issues:

1. Set `INVOICE_PDF_INPUT_MODE=native-pdf`.
2. Redeploy.
3. Existing sibling jobs remain valid because they are ordinary `intake_jobs` and `extraction_results` rows.
4. New bundled PDFs may again only extract the first invoice until page-wise mode is re-enabled.

## Self-Review

- Spec coverage: The plan covers PDF page extraction, classification of multiple invoice numbers, persistence of sibling review jobs, manual retry parity, docs, config, and verification.
- Placeholder scan: No task contains TBD/TODO/later placeholders.
- Type consistency: `InvoicePdfInputMode`, `InvoiceExtractionPageInput`, `additionalDrafts`, `PageDraftResult`, and sibling job IDs are consistently named across tasks.
