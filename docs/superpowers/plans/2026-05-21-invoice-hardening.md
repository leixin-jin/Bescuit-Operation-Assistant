# Invoice Intake Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make invoice intake safe against duplicate uploads and duplicate accounting, add a deployment access gate, preserve queue DLQ behavior, strengthen invoice readiness validation, and prevent local secrets from being copied into build artifacts.

**Architecture:** Treat file identity and invoice identity as two separate idempotency layers. File uploads dedupe by SHA-256 content hash before storing another R2 object, while accounting dedupes by a normalized supplier/document/date key before writing invoices, items, and ledger entries. Operational hardening stays narrowly scoped: Worker-level Basic Auth, retry-to-DLQ queue behavior, stricter domain validation, and a post-build secret artifact guard.

**Tech Stack:** TypeScript, React Start/TanStack Router, Cloudflare Workers, D1, R2, Queues, Drizzle schema definitions, Vitest, Wrangler.

---

## File Structure

- Create: `migrations/0003_invoice_idempotency_and_auth.sql`
  - Adds `source_documents.content_hash`, `invoices.dedupe_key`, and unique indexes.
- Modify: `src/lib/db/schema.ts`
  - Mirrors the new D1 columns and indexes in Drizzle schema.
- Modify: `src/lib/server/upload.ts`
  - Computes file SHA-256, checks for an existing non-deleting upload, and returns the existing job instead of enqueueing a duplicate.
- Modify: `src/lib/server/mutations/invoices.rpc.ts`
  - Computes a natural invoice dedupe key and reuses the same invoice/ledger rows across duplicate jobs.
- Modify: `src/lib/server/app-domain.ts`
  - Rejects invalid dates, zero/negative totals, tax larger than total, and invalid line item amounts.
- Modify: `src/server.ts`
  - Adds Basic Auth at the Worker entry point and changes queue failures to retry so Cloudflare can send exhausted messages to the configured DLQ.
- Modify: `src/lib/env.d.ts`
  - Regenerate with Wrangler after adding auth vars, or add the two optional fields if typegen cannot run.
- Modify: `package.json`
  - Adds a `postbuild` guard that fails if `dist/server/.dev.vars` exists.
- Modify: `.gitignore`
  - Adds `dist/server/.dev.vars` explicitly so the risk is visible even though `dist` is already ignored.
- Modify: `README.md`
  - Documents migration order, auth secrets, duplicate behavior, and the build secret guard.
- Modify: `src/tests/real-data-integration.test.ts`
  - Adds integration coverage for duplicate invoice accounting and fake D1 support for the new SQL comments.
- Modify: `src/tests/invoice-mock-store.test.ts`
  - Adds domain validation coverage.
- Create: `src/tests/server-entry.test.ts`
  - Adds Worker auth and queue retry/DLQ behavior coverage.
- Create: `src/tests/build-artifact-safety.test.ts`
  - Adds a cheap repository-level check for the secret artifact guard.

---

## Task 1: Add D1 Idempotency Columns

**Files:**
- Create: `migrations/0003_invoice_idempotency_and_auth.sql`
- Modify: `src/lib/db/schema.ts`

- [x] **Step 1: Create the migration**

Create `migrations/0003_invoice_idempotency_and_auth.sql`:

```sql
ALTER TABLE source_documents ADD COLUMN content_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS source_documents_content_hash_unique_idx
  ON source_documents(content_hash);

ALTER TABLE invoices ADD COLUMN dedupe_key TEXT;

UPDATE invoices
SET dedupe_key =
  lower(trim(supplier_name)) || '|' || trim(document_number) || '|' || invoice_date
WHERE dedupe_key IS NULL
  AND supplier_name IS NOT NULL
  AND document_number IS NOT NULL
  AND invoice_date IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_dedupe_key_unique_idx
  ON invoices(dedupe_key);
```

- [x] **Step 2: Update the Drizzle schema**

In `src/lib/db/schema.ts`, add `contentHash` to `sourceDocuments`:

```ts
    contentHash: text('content_hash'),
```

Add the unique index inside the `sourceDocuments` table callback:

```ts
    uniqueIndex('source_documents_content_hash_unique_idx').on(table.contentHash),
```

Add `dedupeKey` to `invoices`:

```ts
    dedupeKey: text('dedupe_key'),
```

Add the unique index inside the `invoices` table callback:

```ts
    uniqueIndex('invoices_dedupe_key_unique_idx').on(table.dedupeKey),
```

- [x] **Step 3: Verify schema compiles**

Run:

```bash
pnpm test src/tests/real-data-integration.test.ts
```

Expected result:

```text
Test Files  1 passed
```

- [x] **Step 4: Commit**

Run:

```bash
git add migrations/0003_invoice_idempotency_and_auth.sql src/lib/db/schema.ts
git commit -m "feat: add invoice idempotency schema"
```

---

## Task 2: Dedupe Same File Uploads

**Files:**
- Modify: `src/lib/server/upload.ts`
- Modify: `src/tests/real-data-integration.test.ts`

- [x] **Step 1: Add the failing integration test**

In `src/tests/real-data-integration.test.ts`, add `uploadInvoiceSourceDocument` to imports:

```ts
import { uploadInvoiceSourceDocument } from '@/lib/server/upload'
```

Add this test in a new `describe('invoice upload D1 integration', () => { ... })` block before `describe('invoice review D1 integration', ...)`:

```ts
describe('invoice upload D1 integration', () => {
  test('uploading identical file bytes reuses the existing intake job', async () => {
    const { env, tables } = createFakeD1Env()
    env.RAW_DOCUMENTS = createFakeR2Bucket({})
    env.INTAKE_QUEUE = createFakeQueue()

    const first = await uploadInvoiceSourceDocument({
      env,
      file: new File(['same-invoice-bytes'], 'invoice-a.pdf', {
        type: 'application/pdf',
      }),
    })
    const second = await uploadInvoiceSourceDocument({
      env,
      file: new File(['same-invoice-bytes'], 'invoice-b.pdf', {
        type: 'application/pdf',
      }),
    })

    expect(second).toEqual(first)
    expect(tables.source_documents).toHaveLength(1)
    expect(tables.intake_jobs).toHaveLength(1)
    expect(await env.RAW_DOCUMENTS.get(first.r2Key)).not.toBeNull()
    expect((env.INTAKE_QUEUE as unknown as FakeQueue).sentMessages).toHaveLength(1)
  })
})
```

Add a fake queue type and helper near the fake R2 helpers:

```ts
interface FakeQueue {
  sentMessages: unknown[]
  send: (message: unknown) => Promise<void>
}

function createFakeQueue(): Queue & FakeQueue {
  const queue: FakeQueue = {
    sentMessages: [],
    async send(message) {
      queue.sentMessages.push(message)
    },
  }

  return queue as Queue & FakeQueue
}
```

Extend `SourceDocumentRow` with:

```ts
  content_hash: string | null
```

Extend `createSourceDocumentRow` with:

```ts
    content_hash: null,
```

Extend fake D1 `selectRows()` with:

```ts
    if (sql.includes('invoice-upload:find-duplicate')) {
      const [contentHash] = this.params
      const sourceDocument = this.tables.source_documents.find(
        (row) => row.content_hash === contentHash,
      )
      const job = this.tables.intake_jobs.find(
        (row) =>
          row.source_document_id === sourceDocument?.id && row.stage !== 'deleting',
      )

      return sourceDocument && job
        ? [
            {
              jobId: job.id,
              sourceDocumentId: sourceDocument.id,
              r2Key: sourceDocument.r2_key,
            },
          ]
        : []
    }
```

Extend fake D1 `mutateRows()` with insert handling for upload source documents and jobs if Drizzle-generated SQL is not already handled by the fake. Match the SQL by table name and bind order observed in the failing test output:

```ts
    if (sql.includes('insert into "source_documents"')) {
      const [
        id,
        sourceType,
        documentTypeGuess,
        r2Key,
        originalFilename,
        mimeType,
        uploadedBy,
        status,
        uploadedAt,
        contentHash,
      ] = this.params

      this.tables.source_documents.push({
        id: String(id),
        source_type: String(sourceType),
        document_type_guess: String(documentTypeGuess),
        r2_key: r2Key === null ? null : String(r2Key),
        original_filename: String(originalFilename),
        mime_type: mimeType === null ? null : String(mimeType),
        uploaded_by: uploadedBy === null ? null : String(uploadedBy),
        status: String(status),
        uploaded_at: String(uploadedAt),
        content_hash: contentHash === null ? null : String(contentHash),
      })
      return 1
    }

    if (sql.includes('insert into "intake_jobs"')) {
      const [
        id,
        sourceDocumentId,
        extractorProvider,
        extractorModel,
        stage,
        confidenceScore,
        errorMessage,
        createdAt,
        updatedAt,
      ] = this.params

      this.tables.intake_jobs.push({
        id: String(id),
        source_document_id: String(sourceDocumentId),
        extractor_provider:
          extractorProvider === null ? null : String(extractorProvider),
        extractor_model: extractorModel === null ? null : String(extractorModel),
        stage: String(stage),
        confidence_score:
          confidenceScore === null ? null : Number(confidenceScore),
        error_message: errorMessage === null ? null : String(errorMessage),
        created_at: String(createdAt),
        updated_at: String(updatedAt),
      })
      return 1
    }
```

- [x] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm vitest run src/tests/real-data-integration.test.ts -t "uploading identical file bytes"
```

Expected result before implementation:

```text
FAIL src/tests/real-data-integration.test.ts
Expected length: 1
Received length: 2
```

- [x] **Step 3: Implement upload content hashing and duplicate lookup**

In `src/lib/server/upload.ts`, import the raw D1 helper:

```ts
import { allD1, requireD1Database } from '@/lib/server/d1'
```

Add this interface:

```ts
interface ExistingInvoiceUploadRow {
  jobId: string
  sourceDocumentId: string
  r2Key: string | null
}
```

At the start of `uploadInvoiceSourceDocument`, after `db` and `rawDocumentsBucket`, compute the hash and check for an existing upload:

```ts
  const contentHash = await getFileSha256HexDigest(input.file)
  const existingUpload = await findExistingInvoiceUpload(input.env, contentHash)

  if (existingUpload?.r2Key) {
    return {
      jobId: existingUpload.jobId,
      sourceDocumentId: existingUpload.sourceDocumentId,
      r2Key: existingUpload.r2Key,
    } satisfies InvoiceUploadResult
  }
```

Add `contentHash` to the `sourceDocuments` insert values:

```ts
      contentHash,
```

Add these helper functions at the bottom of the file:

```ts
async function getFileSha256HexDigest(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function findExistingInvoiceUpload(
  env: AppBindings,
  contentHash: string,
): Promise<ExistingInvoiceUploadRow | null> {
  const db = requireD1Database(env, 'invoice upload duplicate lookup')
  const rows = await allD1<ExistingInvoiceUploadRow>(
    db,
    `/* invoice-upload:find-duplicate */
    SELECT
      intake_jobs.id AS jobId,
      source_documents.id AS sourceDocumentId,
      source_documents.r2_key AS r2Key
    FROM source_documents
    INNER JOIN intake_jobs
      ON intake_jobs.source_document_id = source_documents.id
    WHERE source_documents.content_hash = ?
      AND intake_jobs.stage != 'deleting'
    ORDER BY intake_jobs.created_at DESC
    LIMIT 1`,
    [contentHash],
  )

  return rows[0] ?? null
}
```

- [x] **Step 4: Run the focused test and verify it passes**

Run:

```bash
pnpm vitest run src/tests/real-data-integration.test.ts -t "uploading identical file bytes"
```

Expected result:

```text
Test Files  1 passed
```

- [x] **Step 5: Run invoice integration tests**

Run:

```bash
pnpm vitest run src/tests/real-data-integration.test.ts
```

Expected result:

```text
Test Files  1 passed
```

- [x] **Step 6: Commit**

Run:

```bash
git add src/lib/server/upload.ts src/tests/real-data-integration.test.ts
git commit -m "fix: reuse duplicate invoice uploads"
```

---

## Task 3: Dedupe Confirmed Invoice Accounting

**Files:**
- Modify: `src/lib/server/mutations/invoices.rpc.ts`
- Modify: `src/tests/real-data-integration.test.ts`

- [x] **Step 1: Add the failing accounting test**

In `src/tests/real-data-integration.test.ts`, add this test in `describe('invoice review D1 integration', ...)`:

```ts
  test('confirming the same supplier invoice from two jobs reuses invoice and ledger rows', async () => {
    const { env, tables } = createFakeD1Env({
      source_documents: [
        createSourceDocumentRow({ id: 'src-a' }),
        createSourceDocumentRow({ id: 'src-b' }),
      ],
      intake_jobs: [
        createIntakeJobRow({
          id: 'job-a',
          source_document_id: 'src-a',
          stage: 'needs_review',
        }),
        createIntakeJobRow({
          id: 'job-b',
          source_document_id: 'src-b',
          stage: 'needs_review',
        }),
      ],
      extraction_results: [
        createExtractionResultRow({ id: 'ext-a', intake_job_id: 'job-a' }),
        createExtractionResultRow({ id: 'ext-b', intake_job_id: 'job-b' }),
      ],
    })

    const firstJob = createReadyReviewJob({
      jobId: 'job-a',
      fileName: 'first.pdf',
    })
    const secondJob = createReadyReviewJob({
      jobId: 'job-b',
      fileName: 'second.pdf',
    })

    await expect(confirmInvoiceReviewJobInDatabase(env, firstJob)).resolves.toMatchObject({
      ok: true,
    })
    await expect(confirmInvoiceReviewJobInDatabase(env, secondJob)).resolves.toMatchObject({
      ok: true,
    })

    expect(tables.invoices).toHaveLength(1)
    expect(tables.invoice_items).toHaveLength(1)
    expect(tables.ledger_entries).toHaveLength(1)
    expect(tables.invoices[0]).toMatchObject({
      supplier_name: 'Makro Madrid',
      document_number: 'MK-001',
      invoice_date: '2026-04-20',
      total_amount: 121,
      dedupe_key: 'makro madrid|MK-001|2026-04-20',
    })
    expect(tables.ledger_entries[0]?.source_id).toBe(tables.invoices[0]?.id)
  })
```

Add this helper near `createSourceDocumentRow`:

```ts
function createExtractionResultRow(
  overrides: Partial<ExtractionResultRow> = {},
): ExtractionResultRow {
  return {
    id: 'ext-job-1',
    intake_job_id: 'job-1',
    markdown_text: '',
    structured_json: null,
    raw_response: null,
    schema_version: 'invoice-extraction-v1',
    created_at: '2026-04-27T10:00:00.000Z',
    ...overrides,
  }
}
```

Extend `InvoiceRow` with:

```ts
  dedupe_key: string | null
```

Extend `createInvoiceRow` with:

```ts
    dedupe_key: null,
```

- [x] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm vitest run src/tests/real-data-integration.test.ts -t "same supplier invoice"
```

Expected result before implementation:

```text
FAIL src/tests/real-data-integration.test.ts
Expected length: 1
Received length: 2
```

- [x] **Step 3: Implement dedupe-key accounting**

In `src/lib/server/mutations/invoices.rpc.ts`, add:

```ts
interface InvoiceIdRow {
  id: string
}
```

In `writeConfirmedInvoiceAccounting`, compute:

```ts
  const invoiceDedupeKey = getInvoiceDedupeKey(job)
```

Add `dedupe_key` to the `INSERT INTO invoices` column list:

```sql
        dedupe_key,
```

Add one more `?` to the `SELECT` values before `'ready'`:

```sql
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?
```

Change the conflict target:

```sql
      ON CONFLICT(dedupe_key) DO UPDATE SET
        intake_job_id = excluded.intake_job_id,
        invoice_date = excluded.invoice_date,
        supplier_name = excluded.supplier_name,
        document_number = excluded.document_number,
        subtotal_amount = excluded.subtotal_amount,
        tax_amount = excluded.tax_amount,
        total_amount = excluded.total_amount,
        source_document_id = excluded.source_document_id,
        review_status = excluded.review_status,
        updated_at = excluded.updated_at
```

Bind `invoiceDedupeKey` after `sourceDocumentId`:

```ts
      sourceDocumentId,
      invoiceDedupeKey,
      now,
```

After `assertInvoiceMutationChanged(...)`, resolve the persisted invoice id:

```ts
  const persistedInvoiceId = await getPersistedInvoiceId(db, invoiceDedupeKey)
  const persistedLedgerEntryId = getLedgerEntryId(persistedInvoiceId)
```

Use `persistedInvoiceId` instead of `invoiceId` for delete-items, item IDs, item inserts, ledger `source_id`, and ledger ID:

```ts
      .bind(persistedInvoiceId),
```

```ts
          getInvoiceItemId(persistedInvoiceId, index),
          persistedInvoiceId,
```

```ts
        persistedLedgerEntryId,
```

```ts
        persistedInvoiceId,
```

Add helpers near `getSourceDocumentId`:

```ts
async function getPersistedInvoiceId(db: D1Database, dedupeKey: string) {
  const rows = await allD1<InvoiceIdRow>(
    db,
    `/* invoice:get-persisted-invoice-id */
    SELECT id
    FROM invoices
    WHERE dedupe_key = ?
    LIMIT 1`,
    [dedupeKey],
  )
  const invoiceId = rows[0]?.id

  if (!invoiceId) {
    throw new Error(`Confirmed invoice was not persisted: ${dedupeKey}`)
  }

  return invoiceId
}

function getInvoiceDedupeKey(job: InvoiceReviewJob) {
  return [
    job.header.supplier.trim().toLowerCase(),
    job.header.invoiceNo.trim(),
    job.header.date.trim(),
  ].join('|')
}
```

- [x] **Step 4: Extend fake D1 for the new accounting SQL**

In fake D1 `selectRows()`, add:

```ts
    if (sql.includes('invoice:get-persisted-invoice-id')) {
      const [dedupeKey] = this.params
      const invoice = this.tables.invoices.find(
        (row) => row.dedupe_key === dedupeKey,
      )
      return invoice ? [{ id: invoice.id }] : []
    }
```

In fake D1 `mutateRows()`, update the `invoice:upsert-invoice` param list:

```ts
      const [
        id,
        intakeJobId,
        invoiceDate,
        supplierName,
        documentNumber,
        subtotalAmount,
        taxAmount,
        totalAmount,
        sourceDocumentId,
        dedupeKey,
        now,
        guardJobId,
      ] = this.params
```

Find existing invoices by dedupe key first:

```ts
      const existingRow = this.tables.invoices.find(
        (row) => row.dedupe_key === dedupeKey,
      )
```

Add `dedupe_key` to `nextRow`:

```ts
        dedupe_key: String(dedupeKey),
```

- [x] **Step 5: Run the focused test and verify it passes**

Run:

```bash
pnpm vitest run src/tests/real-data-integration.test.ts -t "same supplier invoice"
```

Expected result:

```text
Test Files  1 passed
```

- [x] **Step 6: Run invoice integration tests**

Run:

```bash
pnpm vitest run src/tests/real-data-integration.test.ts
```

Expected result:

```text
Test Files  1 passed
```

- [x] **Step 7: Commit**

Run:

```bash
git add src/lib/server/mutations/invoices.rpc.ts src/tests/real-data-integration.test.ts
git commit -m "fix: dedupe confirmed invoice accounting"
```

---

## Task 4: Strengthen Invoice Readiness Validation

**Files:**
- Modify: `src/lib/server/app-domain.ts`
- Modify: `src/tests/invoice-mock-store.test.ts`

- [x] **Step 1: Add failing validation tests**

In `src/tests/invoice-mock-store.test.ts`, add these tests:

```ts
  test('invalid invoice dates block ready status', async () => {
    const createdJob = await createInvoiceJob('bad-date.pdf')

    await saveInvoiceJob({
      ...createdJob,
      header: {
        supplier: 'Makro Madrid',
        invoiceNo: 'MK-889120',
        date: '2026-99-99',
        totalAmount: '248.90',
        taxAmount: '34.56',
        notes: '',
      },
    })

    const storedJob = await getInvoiceJob(createdJob.jobId)

    expect(storedJob?.status).toBe('needs_review')
    expect(getInvoiceReadinessSummary(storedJob!).invalidHeaderFields).toContain(
      '发票日期',
    )
  })

  test('tax larger than total blocks ready status', async () => {
    const createdJob = await createInvoiceJob('bad-tax.pdf')

    await saveInvoiceJob({
      ...createdJob,
      header: {
        supplier: 'Makro Madrid',
        invoiceNo: 'MK-889120',
        date: '2026-04-24',
        totalAmount: '20.00',
        taxAmount: '21.00',
        notes: '',
      },
    })

    const storedJob = await getInvoiceJob(createdJob.jobId)

    expect(storedJob?.status).toBe('needs_review')
    expect(getInvoiceReadinessSummary(storedJob!).invalidHeaderFields).toContain(
      '税额不能大于总金额',
    )
  })

  test('invalid line item numbers block ready status', async () => {
    const createdJob = await createInvoiceJob('bad-line.pdf')

    await saveInvoiceJob({
      ...createdJob,
      header: {
        supplier: 'Makro Madrid',
        invoiceNo: 'MK-889120',
        date: '2026-04-24',
        totalAmount: '20.00',
        taxAmount: '2.00',
        notes: '',
      },
      lineItems: [
        {
          id: 'line-1',
          name: 'Coke',
          qty: '-2',
          unit: 'un',
          unitPrice: '10.00',
          lineTotal: '20.00',
          ingredient: '',
          matched: false,
        },
      ],
    })

    const storedJob = await getInvoiceJob(createdJob.jobId)

    expect(storedJob?.status).toBe('needs_review')
    expect(getInvoiceReadinessSummary(storedJob!).invalidHeaderFields).toContain(
      '明细金额',
    )
  })
```

- [x] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
pnpm vitest run src/tests/invoice-mock-store.test.ts -t "invalid invoice dates|tax larger|invalid line item"
```

Expected result before implementation:

```text
FAIL src/tests/invoice-mock-store.test.ts
```

- [x] **Step 3: Implement stricter validation**

In `src/lib/server/app-domain.ts`, change `getInvoiceReadinessSummary` to pass the full job:

```ts
  const invalidHeaderFields = getInvalidHeaderFields(job)
```

Replace `getInvalidHeaderFields` with:

```ts
function getInvalidHeaderFields(job: Pick<InvoiceReviewJob, 'header' | 'lineItems'>) {
  const invalidFields: string[] = []
  const { header } = job

  if (header.date.trim() !== '' && !isIsoDateInput(header.date)) {
    invalidFields.push('发票日期')
  }

  if (header.totalAmount.trim() !== '' && !isPositiveInvoiceAmount(header.totalAmount)) {
    invalidFields.push('总金额')
  }

  if (header.taxAmount.trim() !== '' && !isInvoiceAmount(header.taxAmount)) {
    invalidFields.push('税额')
  }

  if (
    isInvoiceAmount(header.totalAmount) &&
    isInvoiceAmount(header.taxAmount) &&
    parseCurrencyAmount(header.taxAmount) > parseCurrencyAmount(header.totalAmount)
  ) {
    invalidFields.push('税额不能大于总金额')
  }

  if (job.lineItems.some(hasInvalidLineItemAmount)) {
    invalidFields.push('明细金额')
  }

  return invalidFields
}
```

Add helpers below `isInvoiceAmount`:

```ts
function isPositiveInvoiceAmount(value: string) {
  return isInvoiceAmount(value) && parseCurrencyAmount(value) > 0
}

function isIsoDateInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return false
  }

  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function hasInvalidLineItemAmount(item: InvoiceLineItemDraft) {
  return (
    isInvalidOptionalPositiveAmount(item.qty) ||
    isInvalidOptionalPositiveAmount(item.unitPrice) ||
    isInvalidOptionalPositiveAmount(item.lineTotal ?? '')
  )
}

function isInvalidOptionalPositiveAmount(value: string) {
  const trimmedValue = value.trim()
  return trimmedValue !== '' && (!isInvoiceAmount(trimmedValue) || parseCurrencyAmount(trimmedValue) <= 0)
}
```

- [x] **Step 4: Run validation tests and verify they pass**

Run:

```bash
pnpm vitest run src/tests/invoice-mock-store.test.ts
```

Expected result:

```text
Test Files  1 passed
```

- [x] **Step 5: Run integration tests that confirm invoices**

Run:

```bash
pnpm vitest run src/tests/real-data-integration.test.ts
```

Expected result:

```text
Test Files  1 passed
```

- [x] **Step 6: Commit**

Run:

```bash
git add src/lib/server/app-domain.ts src/tests/invoice-mock-store.test.ts
git commit -m "fix: reject invalid invoice review data"
```

---

## Task 5: Add Worker-Level Basic Auth

**Files:**
- Modify: `src/server.ts`
- Modify: `src/lib/env.d.ts`
- Create: `src/tests/server-entry.test.ts`
- Modify: `README.md`

- [x] **Step 1: Add failing Worker auth tests**

Create `src/tests/server-entry.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest'

vi.mock('@tanstack/react-start/server-entry', () => ({
  default: {
    fetch: vi.fn(() => new Response('app ok')),
  },
}))

vi.mock('@/lib/server/queries/document-preview', () => ({
  getInvoiceDocumentPreviewResponse: vi.fn(() => new Response('preview ok')),
}))

vi.mock('@/lib/server/extraction', () => ({
  processInvoiceIntakeQueueMessage: vi.fn(),
}))

describe('worker entry auth', () => {
  test('production requests are rejected when Basic Auth is missing', async () => {
    const { default: worker } = await import('@/server')

    const response = await worker.fetch(
      new Request('https://example.com/invoices/new'),
      {
        MODE: 'production',
        APP_BASIC_AUTH_USER: 'admin',
        APP_BASIC_AUTH_PASSWORD: 'secret',
      } as Env,
      {} as ExecutionContext,
    )

    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('Basic')
  })

  test('production requests continue with a valid Basic Auth header', async () => {
    const { default: worker } = await import('@/server')

    const response = await worker.fetch(
      new Request('https://example.com/invoices/new', {
        headers: {
          Authorization: `Basic ${btoa('admin:secret')}`,
        },
      }),
      {
        MODE: 'production',
        APP_BASIC_AUTH_USER: 'admin',
        APP_BASIC_AUTH_PASSWORD: 'secret',
      } as Env,
      {} as ExecutionContext,
    )

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('app ok')
  })

  test('local development remains open when auth secrets are absent', async () => {
    const { default: worker } = await import('@/server')

    const response = await worker.fetch(
      new Request('http://localhost:3000/invoices/new'),
      { MODE: 'development' } as Env,
      {} as ExecutionContext,
    )

    expect(response.status).toBe(200)
  })
})
```

- [x] **Step 2: Run auth tests and verify they fail**

Run:

```bash
pnpm vitest run src/tests/server-entry.test.ts -t "worker entry auth"
```

Expected result before implementation:

```text
FAIL src/tests/server-entry.test.ts
Expected: 401
Received: 200
```

- [x] **Step 3: Implement Basic Auth in `src/server.ts`**

At the top of `fetch`, before document preview handling, add:

```ts
    const authResponse = requireAppBasicAuth(request, env)

    if (authResponse) {
      return authResponse
    }
```

Add helpers at the bottom of `src/server.ts`:

```ts
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

  const authorization = request.headers.get('Authorization')
  const expectedCredentials = `${user}:${password}`

  if (authorization === `Basic ${btoa(expectedCredentials)}`) {
    return null
  }

  return new Response('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Bescuit Operation Assistant"',
    },
  })
}
```

- [x] **Step 4: Update env types**

If Wrangler is available, run:

```bash
pnpm wrangler types src/lib/env.d.ts
```

Then add these optional fields to `Cloudflare.Env` if Wrangler did not infer them from secrets:

```ts
		MODE?: string;
		APP_BASIC_AUTH_USER?: string;
		APP_BASIC_AUTH_PASSWORD?: string;
```

- [x] **Step 5: Document auth setup**

In `README.md`, add a deployment note:

````md
### Production Access Gate

Production requires Basic Auth at the Worker entry point. Set both secrets before exposing the app:

```bash
wrangler secret put APP_BASIC_AUTH_USER
wrangler secret put APP_BASIC_AUTH_PASSWORD
```

When `MODE=production`, missing auth secrets return HTTP 500 so the app cannot be accidentally published without an access gate.
````

- [x] **Step 6: Run auth tests**

Run:

```bash
pnpm vitest run src/tests/server-entry.test.ts -t "worker entry auth"
```

Expected result:

```text
Test Files  1 passed
```

- [x] **Step 7: Commit**

Run:

```bash
git add src/server.ts src/lib/env.d.ts src/tests/server-entry.test.ts README.md
git commit -m "feat: require basic auth in production"
```

---

## Task 6: Preserve Cloudflare Queue DLQ Behavior

**Files:**
- Modify: `src/server.ts`
- Modify: `src/tests/server-entry.test.ts`

- [x] **Step 1: Add the failing queue retry test**

In `src/tests/server-entry.test.ts`, extend the extraction mock so failures can be controlled:

```ts
import { processInvoiceIntakeQueueMessage } from '@/lib/server/extraction'
```

Add this test:

```ts
describe('worker queue handling', () => {
  test('failed valid messages are retried instead of acked at max attempts', async () => {
    vi.mocked(processInvoiceIntakeQueueMessage).mockRejectedValueOnce(
      new Error('extractor unavailable'),
    )
    const { default: worker } = await import('@/server')
    const message = createQueueMessage({
      attempts: 3,
      body: {
        jobId: 'job-1',
        sourceDocumentId: 'src-1',
        r2Key: 'raw-documents/2026/04/invoice.pdf',
        fileName: 'invoice.pdf',
        mimeType: 'application/pdf',
        uploadedAt: '2026-04-27T10:00:00.000Z',
      },
    })

    await worker.queue(
      {
        queue: 'bescuit-operation-assistant-intake',
        messages: [message],
      } as unknown as MessageBatch,
      {} as Env,
    )

    expect(message.ack).not.toHaveBeenCalled()
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 60 })
  })
})

function createQueueMessage(input: { attempts: number; body: unknown }) {
  return {
    id: 'msg-1',
    attempts: input.attempts,
    body: input.body,
    ack: vi.fn(),
    retry: vi.fn(),
  }
}
```

- [x] **Step 2: Run the queue test and verify it fails**

Run:

```bash
pnpm vitest run src/tests/server-entry.test.ts -t "failed valid messages"
```

Expected result before implementation:

```text
FAIL src/tests/server-entry.test.ts
expected "ack" not to be called
```

- [x] **Step 3: Change queue failure handling**

In `src/server.ts`, replace:

```ts
        if (message.attempts >= MAX_QUEUE_CONSUMER_ATTEMPTS) {
          message.ack()
          continue
        }

        message.retry({
          delaySeconds: QUEUE_RETRY_DELAY_SECONDS,
        })
```

with:

```ts
        message.retry({
          delaySeconds: QUEUE_RETRY_DELAY_SECONDS,
        })
```

Remove `MAX_QUEUE_CONSUMER_ATTEMPTS` from the import list if it becomes unused.

- [x] **Step 4: Run queue tests**

Run:

```bash
pnpm vitest run src/tests/server-entry.test.ts -t "worker queue handling"
```

Expected result:

```text
Test Files  1 passed
```

- [x] **Step 5: Commit**

Run:

```bash
git add src/server.ts src/tests/server-entry.test.ts
git commit -m "fix: let failed intake messages reach dlq"
```

---

## Task 7: Block Secret Files In Build Artifacts

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `src/tests/build-artifact-safety.test.ts`
- Modify: `README.md`

- [x] **Step 1: Add the failing repository safety test**

Create `src/tests/build-artifact-safety.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

describe('build artifact safety', () => {
  test('postbuild fails if local dev vars are copied into dist', () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> }

    expect(packageJson.scripts?.postbuild).toContain('dist/server/.dev.vars')
  })

  test('dist dev vars are explicitly ignored', () => {
    const gitignore = readFileSync(join(process.cwd(), '.gitignore'), 'utf8')

    expect(gitignore).toContain('dist/server/.dev.vars')
  })
})
```

- [x] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm vitest run src/tests/build-artifact-safety.test.ts
```

Expected result before implementation:

```text
FAIL src/tests/build-artifact-safety.test.ts
```

- [x] **Step 3: Add the postbuild guard**

In `package.json`, add this script:

```json
"postbuild": "test ! -f dist/server/.dev.vars"
```

- [x] **Step 4: Make the ignore rule explicit**

In `.gitignore`, add:

```gitignore
dist/server/.dev.vars
```

- [x] **Step 5: Document the guard**

In `README.md`, add:

```md
### Build Artifact Secret Guard

`pnpm build` runs a postbuild check that fails if `dist/server/.dev.vars` exists. If the check fails, remove that generated file and keep runtime secrets in `.dev.vars` locally or Wrangler secrets remotely.
```

- [x] **Step 6: Run the safety test**

Run:

```bash
pnpm vitest run src/tests/build-artifact-safety.test.ts
```

Expected result:

```text
Test Files  1 passed
```

- [x] **Step 7: Commit**

Run:

```bash
git add package.json .gitignore README.md src/tests/build-artifact-safety.test.ts
git commit -m "chore: block dev vars in build output"
```

---

## Task 8: Final Verification And Deployment Notes

**Files:**
- Modify: `README.md`

- [x] **Step 1: Document duplicate behavior**

In `README.md`, add:

```md
### Duplicate Invoice Behavior

Uploading the same file bytes reuses the existing invoice intake job and does not enqueue another extraction job. Confirming two jobs with the same supplier, document number, and invoice date updates the same invoice, invoice items, and ledger entry instead of double-counting expenses.
```

- [x] **Step 2: Document migration order**

In `README.md`, update the migration command section so all migrations are listed:

```bash
wrangler d1 execute bescuit-operation-assistant-db --remote --file migrations/0001_initial.sql
wrangler d1 execute bescuit-operation-assistant-db --remote --file migrations/0002_real_data_constraints_and_ingredients.sql
wrangler d1 execute bescuit-operation-assistant-db --remote --file migrations/0003_invoice_idempotency_and_auth.sql
```

- [x] **Step 3: Run the full verification suite**

Run:

```bash
pnpm test
pnpm build
```

Expected result:

```text
Test Files  all passed
✓ built
```

If `pnpm build` fails because `dist/server/.dev.vars` exists, run:

```bash
rm dist/server/.dev.vars
pnpm build
```

Expected result after removing the generated secret file:

```text
✓ built
```

- [x] **Step 4: Commit docs and final fixes**

Run:

```bash
git add README.md
git commit -m "docs: document invoice hardening behavior"
```

- [x] **Step 5: Apply the migration locally and remotely**

Run locally:

```bash
wrangler d1 execute bescuit-operation-assistant-db --local --file migrations/0003_invoice_idempotency_and_auth.sql
```

Run remotely after tests pass:

```bash
wrangler d1 execute bescuit-operation-assistant-db --remote --file migrations/0003_invoice_idempotency_and_auth.sql
```

Expected result:

```text
🌀 Executing on local database
```

and then:

```text
🌀 Executing on remote database
```

---

## Self-Review Checklist

- Duplicate upload is covered at the source document layer by `content_hash`.
- Duplicate accounting is covered at the invoice layer by `dedupe_key`.
- Same-job confirmation remains idempotent through the existing invoice and ledger upserts.
- Two different jobs with the same supplier/document/date no longer double-count expenses.
- Production requests without Basic Auth are rejected before document preview or React Start handling.
- Queue failures call `retry()` and do not `ack()` exhausted messages, preserving Cloudflare DLQ behavior.
- Invoice readiness rejects malformed dates, invalid totals, tax greater than total, and invalid line item amounts.
- Build fails when local dev vars appear under `dist/server/.dev.vars`.
- Final verification commands are `pnpm test` and `pnpm build`.
