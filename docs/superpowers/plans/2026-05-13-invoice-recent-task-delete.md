# Invoice Recent Task Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users delete unfinished invoice intake tasks from the `发票 intake` page recent-task list, and delete the matching R2 raw document for real pipeline tasks.

**Architecture:** Add one shared domain predicate for whether an invoice job can be deleted, then expose delete behavior through the existing local fallback mutation and the Cloudflare server function mutation. The real pipeline delete path must load the job and source document, reject completed `ready` jobs, call `RAW_DOCUMENTS.delete(r2Key)`, then remove D1 rows in dependency order. The route renders delete controls only for unfinished recent jobs and invalidates invoice/dashboard queries after success.

**Tech Stack:** React 19, TanStack Router, TanStack Query, TanStack React Start server functions, Cloudflare D1, Cloudflare R2, Drizzle, Vitest, Testing Library.

---

## File Structure

- Modify: `src/lib/server/app-domain.ts`
  - Add `isInvoiceJobDeletable(job)` so UI, fallback, and server mutation share the same definition.
  - Definition: every stage except `ready` is deletable; missing `stage` falls back through `getInvoiceJobStage`.
- Modify: `src/lib/server/fallback-store.ts`
  - Add session-storage deletion for local/demo mode.
  - Store deleted job ids in a second session-storage key so deletable seed/demo jobs do not reappear after refresh.
- Modify: `src/lib/server/demo-data.ts`
  - Re-export the fallback deletion function.
- Modify: `src/lib/server/mutations/invoices.ts`
  - Add `deleteInvoiceIntakeJob(jobId)` for non-pipeline mode.
- Modify: `src/features/invoices/mock-store.ts`
  - Re-export delete support for existing mock-store tests.
- Modify: `src/lib/server/mutations/invoices.rpc.ts`
  - Add `deleteInvoiceIntakeJobServerFn`.
  - Add `deleteInvoiceIntakeJobFromDatabase(env, jobId)` helper for direct integration tests.
  - Delete R2 object and then D1 rows in this order: `extraction_results`, `intake_jobs`, `source_documents`.
- Modify: `src/lib/server/extraction.ts`
  - Make queue processing treat a missing intake job as an idempotent no-op, so already-deleted queued messages are acknowledged instead of retried.
- Modify: `src/routes/invoices/new.tsx`
  - Replace the all-card `<Link>` recent-task row with a row containing an explicit open link and an icon delete button.
  - Add confirmation dialog for unfinished jobs.
  - Hide/disable deletion for `ready` jobs.
- Modify: `src/tests/invoice-mock-store.test.ts`
  - Cover local delete and completed-job rejection.
- Modify: `src/tests/real-data-integration.test.ts`
  - Cover D1 + R2 deletion, completed-job rejection, and missing-job idempotency in the fake D1/R2 boundary.
- Modify: `src/tests/invoice-intake-rehydration.test.tsx`
  - Cover the recent-task delete button on `/invoices/new`.

---

### Task 1: Add Shared Deletable Predicate and Local Fallback Delete

**Files:**
- Modify: `src/lib/server/app-domain.ts`
- Modify: `src/lib/server/fallback-store.ts`
- Modify: `src/lib/server/demo-data.ts`
- Modify: `src/lib/server/mutations/invoices.ts`
- Modify: `src/features/invoices/mock-store.ts`
- Test: `src/tests/invoice-mock-store.test.ts`

- [ ] **Step 1: Write failing mock-store tests**

Append these tests inside `describe('invoice mock store', () => { ... })` in `src/tests/invoice-mock-store.test.ts`:

```ts
  test('unfinished jobs can be deleted from the browser session store', async () => {
    const createdJob = await createInvoiceJob('delete-me.pdf')

    await expect(deleteInvoiceJob(createdJob.jobId)).resolves.toEqual({
      ok: true,
      deleted: true,
    })

    expect(await getInvoiceJob(createdJob.jobId)).toBeNull()
    expect((await listInvoiceJobs()).map((job) => job.jobId)).not.toContain(
      createdJob.jobId,
    )
  })

  test('ready jobs cannot be deleted from the browser session store', async () => {
    const createdJob = await createInvoiceJob('ready.pdf')
    await saveInvoiceJob({
      ...createdJob,
      stage: 'ready',
      status: 'ready',
      header: {
        supplier: 'Makro Madrid',
        invoiceNo: 'MK-889120',
        date: '2026-04-24',
        totalAmount: '248.90',
        taxAmount: '34.56',
        notes: '',
      },
      lineItems: createdJob.lineItems.map((item) => ({
        ...item,
        ingredient: 'coke-330',
        matched: true,
        unitPrice: '1.50',
      })),
    })

    await expect(deleteInvoiceJob(createdJob.jobId)).rejects.toThrow(
      /已完成|cannot delete/i,
    )
    expect(await getInvoiceJob(createdJob.jobId)).not.toBeNull()
  })
```

Update the import list in the same test file:

```ts
import {
  createInvoiceJob,
  deleteInvoiceJob,
  getInvoiceJob,
  getInvoiceReadinessSummary,
  listInvoiceJobs,
  saveInvoiceJob,
} from '@/features/invoices/mock-store'
```

- [ ] **Step 2: Run the mock-store test and verify it fails**

Run:

```bash
pnpm vitest run src/tests/invoice-mock-store.test.ts
```

Expected: FAIL because `deleteInvoiceJob` is not exported yet.

- [ ] **Step 3: Add the shared domain predicate**

In `src/lib/server/app-domain.ts`, add this function below `isInvoiceJobProcessing`:

```ts
export function isInvoiceJobDeletable(
  job: Pick<InvoiceReviewJob, 'stage' | 'status'>,
) {
  return getInvoiceJobStage(job) !== 'ready'
}
```

- [ ] **Step 4: Implement local fallback deletion**

In `src/lib/server/fallback-store.ts`, add a storage key near the existing invoice key:

```ts
const INVOICE_DELETED_SESSION_STORAGE_KEY =
  'bescuit-operation-assistant:deleted-invoice-jobs'
```

Add `isInvoiceJobDeletable` to the existing import from `app-domain`:

```ts
  isInvoiceJobDeletable,
```

Update `listStoredInvoiceJobs()` so deleted seed ids are filtered before sorting:

```ts
export function listStoredInvoiceJobs() {
  const deletedJobIds = readDeletedInvoiceJobIds()
  const jobMap = new Map(
    getSeedInvoiceJobs()
      .filter((job) => !deletedJobIds.has(job.jobId))
      .map((job) => [job.jobId, cloneInvoiceJob(job)]),
  )

  for (const storedJob of readStoredInvoiceJobs()) {
    if (!deletedJobIds.has(storedJob.jobId)) {
      jobMap.set(storedJob.jobId, cloneInvoiceJob(normalizeInvoiceJob(storedJob)))
    }
  }

  return Array.from(jobMap.values())
    .sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt))
    .map(cloneInvoiceJob)
}
```

Add this exported function below `upsertStoredInvoiceJob`:

```ts
export function deleteStoredInvoiceJob(jobId: string) {
  const existingJob = getStoredInvoiceJob(jobId)

  if (!existingJob) {
    return {
      ok: true,
      deleted: false,
    }
  }

  if (!isInvoiceJobDeletable(existingJob)) {
    throw new Error('已完成的发票任务不能从最近任务中删除。')
  }

  const storedJobs = readStoredInvoiceJobs().filter((job) => job.jobId !== jobId)
  persistStoredInvoiceJobs(storedJobs)
  persistDeletedInvoiceJobIds(new Set([...readDeletedInvoiceJobIds(), jobId]))

  return {
    ok: true,
    deleted: true,
  }
}
```

Add these helpers below `persistStoredInvoiceJobs`:

```ts
function readDeletedInvoiceJobIds() {
  if (!canUseSessionStorage()) {
    return new Set<string>()
  }

  const rawValue = window.sessionStorage.getItem(INVOICE_DELETED_SESSION_STORAGE_KEY)
  if (!rawValue) {
    return new Set<string>()
  }

  try {
    const parsedValue = JSON.parse(rawValue)
    if (!Array.isArray(parsedValue)) {
      return new Set<string>()
    }

    return new Set(
      parsedValue.filter((value): value is string => typeof value === 'string'),
    )
  } catch {
    window.sessionStorage.removeItem(INVOICE_DELETED_SESSION_STORAGE_KEY)
    return new Set<string>()
  }
}

function persistDeletedInvoiceJobIds(jobIds: Set<string>) {
  if (!canUseSessionStorage()) {
    return
  }

  window.sessionStorage.setItem(
    INVOICE_DELETED_SESSION_STORAGE_KEY,
    JSON.stringify(Array.from(jobIds)),
  )
}
```

- [ ] **Step 5: Re-export local deletion through current boundaries**

In `src/lib/server/demo-data.ts`, add `deleteStoredInvoiceJob` to the import and export lists.

In `src/lib/server/mutations/invoices.ts`, add:

```ts
import {
  createStoredInvoiceJob,
  deleteStoredInvoiceJob,
  upsertStoredInvoiceJob,
} from '@/lib/server/demo-data'
```

Replace the old import block if needed, then add:

```ts
export async function deleteInvoiceIntakeJob(jobId: string) {
  return deleteStoredInvoiceJob(jobId)
}
```

In `src/features/invoices/mock-store.ts`, import `deleteInvoiceIntakeJob` and export:

```ts
export async function deleteInvoiceJob(jobId: string) {
  return deleteInvoiceIntakeJob(jobId)
}
```

- [ ] **Step 6: Run the mock-store test and verify it passes**

Run:

```bash
pnpm vitest run src/tests/invoice-mock-store.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit local deletion boundary**

```bash
git add src/lib/server/app-domain.ts src/lib/server/fallback-store.ts src/lib/server/demo-data.ts src/lib/server/mutations/invoices.ts src/features/invoices/mock-store.ts src/tests/invoice-mock-store.test.ts
git commit -m "feat: add local invoice task deletion"
```

---

### Task 2: Add Real Pipeline Delete with R2 Cleanup

**Files:**
- Modify: `src/lib/server/mutations/invoices.rpc.ts`
- Modify: `src/lib/server/extraction.ts`
- Modify: `src/tests/real-data-integration.test.ts`

- [ ] **Step 1: Write failing integration tests**

In `src/tests/real-data-integration.test.ts`, update the invoice mutation import:

```ts
import {
  confirmInvoiceReviewJobInDatabase,
  deleteInvoiceIntakeJobFromDatabase,
} from '@/lib/server/mutations/invoices.rpc'
```

Add `processInvoiceIntakeQueueMessage` import:

```ts
import { processInvoiceIntakeQueueMessage } from '@/lib/server/extraction'
```

Append these tests inside `describe('invoice review D1 integration', () => { ... })`:

```ts
  test('deleting an unfinished intake job deletes extraction rows, D1 records, and the R2 object', async () => {
    const { env, tables } = createFakeD1Env({
      source_documents: [
        createSourceDocumentRow({
          id: 'src-delete',
          r2_key: 'raw-documents/2026/04/src-delete-invoice.pdf',
          original_filename: 'delete-me.pdf',
        }),
      ],
      intake_jobs: [
        createIntakeJobRow({
          id: 'job-delete',
          source_document_id: 'src-delete',
          stage: 'needs_review',
        }),
      ],
      extraction_results: [
        {
          id: 'ext-delete',
          intake_job_id: 'job-delete',
          markdown_text: 'markdown',
          structured_json: null,
          raw_response: null,
          schema_version: 'invoice-extraction-v1',
          created_at: '2026-04-27T10:00:00.000Z',
        },
      ],
    })
    const r2 = createFakeR2Bucket({
      'raw-documents/2026/04/src-delete-invoice.pdf': {
        body: '%PDF-delete-me',
        contentType: 'application/pdf',
      },
    })
    env.RAW_DOCUMENTS = r2

    await expect(deleteInvoiceIntakeJobFromDatabase(env, 'job-delete')).resolves.toEqual({
      ok: true,
      deleted: true,
    })

    expect(tables.extraction_results).toHaveLength(0)
    expect(tables.intake_jobs).toHaveLength(0)
    expect(tables.source_documents).toHaveLength(0)
    await expect(env.RAW_DOCUMENTS.get('raw-documents/2026/04/src-delete-invoice.pdf')).resolves.toBeNull()
  })

  test('deleting a ready intake job is rejected before D1 or R2 is mutated', async () => {
    const { env, tables } = createFakeD1Env({
      source_documents: [createSourceDocumentRow({ id: 'src-ready' })],
      intake_jobs: [
        createIntakeJobRow({
          id: 'job-ready',
          source_document_id: 'src-ready',
          stage: 'ready',
        }),
      ],
    })
    env.RAW_DOCUMENTS = createFakeR2Bucket({
      'raw-documents/2026/04/src-1-invoice.pdf': {
        body: '%PDF-ready',
        contentType: 'application/pdf',
      },
    })

    await expect(deleteInvoiceIntakeJobFromDatabase(env, 'job-ready')).rejects.toThrow(
      /已完成|cannot delete/i,
    )

    expect(tables.intake_jobs).toHaveLength(1)
    expect(tables.source_documents).toHaveLength(1)
    await expect(env.RAW_DOCUMENTS.get('raw-documents/2026/04/src-1-invoice.pdf')).resolves.not.toBeNull()
  })

  test('queue processing treats a deleted intake job as an idempotent no-op', async () => {
    const { env } = createFakeD1Env()
    env.RAW_DOCUMENTS = createFakeR2Bucket({})

    await expect(
      processInvoiceIntakeQueueMessage(env, {
        jobId: 'job-already-deleted',
        sourceDocumentId: 'src-already-deleted',
        r2Key: 'raw-documents/2026/04/deleted.pdf',
        fileName: 'deleted.pdf',
        mimeType: 'application/pdf',
        uploadedAt: '2026-04-27T10:00:00.000Z',
      }),
    ).resolves.toEqual({
      jobId: 'job-already-deleted',
      stage: 'deleted',
    })
  })
```

- [ ] **Step 2: Extend fake R2 and fake D1 for delete tests**

In `createFakeR2Bucket`, replace the returned object with a mutable object store:

```ts
function createFakeR2Bucket(
  objects: Record<string, { body: string; contentType: string }>,
) {
  const storedObjects = new Map(Object.entries(objects))

  return {
    get: async (key: string) => {
      const object = storedObjects.get(key)

      if (!object) {
        return null
      }

      return {
        httpMetadata: {
          contentType: object.contentType,
        },
        body: object.body,
        arrayBuffer: async () => new TextEncoder().encode(object.body).buffer,
      }
    },
    delete: async (key: string) => {
      storedObjects.delete(key)
    },
  } as unknown as R2Bucket
}
```

In `FakeD1PreparedStatement.selectRows()`, add a branch before the final unhandled error:

```ts
    if (sql.includes('invoice:delete-intake-load')) {
      const [jobId] = this.params
      const job = this.tables.intake_jobs.find((row) => row.id === jobId)
      const sourceDocument = this.tables.source_documents.find(
        (row) => row.id === job?.source_document_id,
      )

      return job && sourceDocument
        ? [
            {
              jobId: job.id,
              stage: job.stage,
              sourceDocumentId: sourceDocument.id,
              r2Key: sourceDocument.r2_key,
            },
          ]
        : []
    }
```

In `FakeD1PreparedStatement.mutateRows()`, add delete branches before the final unhandled error:

```ts
    if (sql.includes('invoice:delete-extractions')) {
      const [jobId] = this.params
      this.tables.extraction_results = this.tables.extraction_results.filter(
        (row) => row.intake_job_id !== jobId,
      )
      return
    }

    if (sql.includes('invoice:delete-intake-job')) {
      const [jobId] = this.params
      this.tables.intake_jobs = this.tables.intake_jobs.filter(
        (row) => row.id !== jobId,
      )
      return
    }

    if (sql.includes('invoice:delete-source-document')) {
      const [sourceDocumentId] = this.params
      this.tables.source_documents = this.tables.source_documents.filter(
        (row) => row.id !== sourceDocumentId,
      )
      return
    }
```

- [ ] **Step 3: Run the integration test and verify it fails**

Run:

```bash
pnpm vitest run src/tests/real-data-integration.test.ts
```

Expected: FAIL because `deleteInvoiceIntakeJobFromDatabase` does not exist and queue missing-job behavior still throws.

- [ ] **Step 4: Implement the server delete mutation**

In `src/lib/server/mutations/invoices.rpc.ts`, add `isInvoiceJobDeletable` to the `app-domain` import:

```ts
  isInvoiceJobDeletable,
```

Add this interface near the existing row interfaces:

```ts
interface DeletableIntakeJobRow {
  jobId: string
  stage: string
  sourceDocumentId: string
  r2Key: string | null
}
```

Add this server function below `uploadInvoiceIntakeDocument`:

```ts
export const deleteInvoiceIntakeJobServerFn = createServerFn({ method: 'POST' })
  .inputValidator((data: { jobId: string }) => {
    if (!data.jobId.trim()) {
      throw new Error('Expected invoice intake job id')
    }

    return {
      jobId: data.jobId.trim(),
    }
  })
  .handler(async ({ data, context }) =>
    deleteInvoiceIntakeJobFromDatabase(getServerEnv(context), data.jobId),
  )
```

Add this exported helper below `confirmInvoiceReviewJobInDatabase`:

```ts
export async function deleteInvoiceIntakeJobFromDatabase(
  env: Partial<AppBindings> | null | undefined,
  jobId: string,
) {
  const db = requireD1Database(env, 'invoice intake delete')
  const rawDocumentsBucket = env?.RAW_DOCUMENTS
  const rows = await allD1<DeletableIntakeJobRow>(
    db,
    `/* invoice:delete-intake-load */
    SELECT
      intake_jobs.id AS jobId,
      intake_jobs.stage AS stage,
      source_documents.id AS sourceDocumentId,
      source_documents.r2_key AS r2Key
    FROM intake_jobs
    INNER JOIN source_documents
      ON source_documents.id = intake_jobs.source_document_id
    WHERE intake_jobs.id = ?
    LIMIT 1`,
    [jobId],
  )
  const row = rows[0]

  if (!row) {
    return {
      ok: true,
      deleted: false,
    }
  }

  if (
    !isInvoiceJobDeletable({
      stage: row.stage as InvoiceReviewJob['stage'],
      status: row.stage === 'ready' ? 'ready' : 'needs_review',
    })
  ) {
    throw new Error('已完成的发票任务不能从最近任务中删除。')
  }

  if (row.r2Key) {
    if (!rawDocumentsBucket) {
      throw new Error('Missing Cloudflare binding: RAW_DOCUMENTS')
    }

    await rawDocumentsBucket.delete(row.r2Key)
  }

  const statements = [
    db
      .prepare(
        `/* invoice:delete-extractions */
        DELETE FROM extraction_results
        WHERE intake_job_id = ?`,
      )
      .bind(jobId),
    db
      .prepare(
        `/* invoice:delete-intake-job */
        DELETE FROM intake_jobs
        WHERE id = ?`,
      )
      .bind(jobId),
    db
      .prepare(
        `/* invoice:delete-source-document */
        DELETE FROM source_documents
        WHERE id = ?`,
      )
      .bind(row.sourceDocumentId),
  ]

  if (typeof db.batch === 'function') {
    await db.batch(statements)
  } else {
    for (const statement of statements) {
      await statement.run()
    }
  }

  return {
    ok: true,
    deleted: true,
  }
}
```

- [ ] **Step 5: Make queue processing idempotent for deleted jobs**

In `src/lib/server/extraction.ts`, replace the missing-job throw in `processInvoiceIntakeQueueMessage`:

```ts
  if (!jobRow) {
    return {
      jobId: message.jobId,
      stage: 'deleted',
    }
  }
```

- [ ] **Step 6: Run the integration test and verify it passes**

Run:

```bash
pnpm vitest run src/tests/real-data-integration.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit pipeline deletion**

```bash
git add src/lib/server/mutations/invoices.rpc.ts src/lib/server/extraction.ts src/tests/real-data-integration.test.ts
git commit -m "feat: delete invoice intake tasks from D1 and R2"
```

---

### Task 3: Add Recent Task Delete UI

**Files:**
- Modify: `src/routes/invoices/new.tsx`
- Modify: `src/tests/invoice-intake-rehydration.test.tsx`

- [ ] **Step 1: Write failing route test**

In `src/tests/invoice-intake-rehydration.test.tsx`, extend imports:

```ts
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
```

Add this mock below the existing `vi.mock('@/lib/server/queries/invoices', ...)` block:

```ts
const deleteInvoiceIntakeJobMock = vi.fn(async () => ({
  ok: true,
  deleted: true,
}))

vi.mock('@/lib/server/mutations/invoices', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/mutations/invoices')>(
    '@/lib/server/mutations/invoices',
  )

  return {
    ...actual,
    deleteInvoiceIntakeJob: deleteInvoiceIntakeJobMock,
  }
})
```

Append this test:

```tsx
  test('users can delete an unfinished recent invoice task', async () => {
    await renderRoute('/invoices/new')

    expect(await screen.findByText('rehydrated-intake.pdf')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '删除 rehydrated-intake.pdf' }))
    fireEvent.click(await screen.findByRole('button', { name: '删除任务' }))

    await waitFor(() => {
      expect(deleteInvoiceIntakeJobMock).toHaveBeenCalledWith(
        'rehydrated-intake-job',
      )
    })
  })
```

- [ ] **Step 2: Run the route test and verify it fails**

Run:

```bash
pnpm vitest run src/tests/invoice-intake-rehydration.test.tsx
```

Expected: FAIL because no delete button exists.

- [ ] **Step 3: Import delete UI and mutation dependencies**

In `src/routes/invoices/new.tsx`, update imports:

```tsx
import {
  ArrowLeft,
  Camera,
  CheckCircle,
  FileImage,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react'
```

Add alert-dialog imports:

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
```

Update mutation imports:

```tsx
import {
  createInvoiceIntakeJob,
  deleteInvoiceIntakeJob,
} from '@/lib/server/mutations/invoices'
import {
  deleteInvoiceIntakeJobServerFn,
  uploadInvoiceIntakeDocument,
} from '@/lib/server/mutations/invoices.rpc'
```

Add the domain predicate import:

```tsx
import { isInvoiceJobDeletable } from '@/lib/server/app-domain'
```

- [ ] **Step 4: Add the delete mutation to the route component**

Inside `InvoiceIntakePage()`, below `createJobMutation`, add:

```tsx
  const deleteJobMutation = useMutation<
    { ok: boolean; deleted: boolean },
    Error,
    string
  >({
    mutationFn: (jobId) =>
      pipelineEnabled
        ? deleteInvoiceIntakeJobServerFn({ data: { jobId } })
        : deleteInvoiceIntakeJob(jobId),
    onSuccess: async () => {
      setFileErrorMessage(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['invoice-jobs'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] }),
        router.invalidate(),
      ])
    },
    onError: (error) => {
      setFileErrorMessage(
        error instanceof Error ? error.message : '删除 intake 任务失败。',
      )
    },
  })
```

- [ ] **Step 5: Replace recent-task card rendering with explicit open/delete controls**

Replace the current `recentJobs.map((job) => ( <Link ...>...</Link> ))` block in the recent-task card with:

```tsx
                recentJobs.map((job) => {
                  const canDelete = isInvoiceJobDeletable(job)
                  const isDeleting =
                    deleteJobMutation.isPending &&
                    deleteJobMutation.variables === job.jobId

                  return (
                    <div
                      key={job.jobId}
                      className="rounded-xl border bg-background p-4 transition-colors hover:border-primary/40 hover:bg-accent/30"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <Link
                          to="/invoices/review/$jobId"
                          params={{ jobId: job.jobId }}
                          className="min-w-0 flex-1"
                        >
                          <p className="truncate font-medium">{job.fileName}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {job.header.supplier || '待补充供应商'} ·{' '}
                            {formatInvoiceTimestamp(job.uploadedAt)}
                          </p>
                        </Link>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant="secondary" className="rounded-lg">
                            {getInvoiceStatusLabel(job.status)}
                          </Badge>
                          {canDelete ? (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 rounded-lg text-muted-foreground hover:text-destructive"
                                  aria-label={`删除 ${job.fileName}`}
                                  disabled={isDeleting}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>删除 intake 任务</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    这会删除最近任务中的 {job.fileName}
                                    ，真实链路会同时删除 R2 里的原始文件。已完成任务不会被删除。
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>取消</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() =>
                                      deleteJobMutation.mutate(job.jobId)
                                    }
                                  >
                                    删除任务
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )
                })
```

- [ ] **Step 6: Run the route test and verify it passes**

Run:

```bash
pnpm vitest run src/tests/invoice-intake-rehydration.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit recent-task UI**

```bash
git add src/routes/invoices/new.tsx src/tests/invoice-intake-rehydration.test.tsx
git commit -m "feat: add delete control for invoice recent tasks"
```

---

### Task 4: Final Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm vitest run src/tests/invoice-mock-store.test.ts src/tests/real-data-integration.test.ts src/tests/invoice-intake-rehydration.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run smoke tests**

Run:

```bash
pnpm run smoke
```

Expected: PASS.

- [ ] **Step 3: Run the full test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 4: Manual UI check**

Start the dev server:

```bash
pnpm run dev
```

Open:

```text
http://localhost:3000/invoices/new
```

Verify:
- Recent tasks with `待核对`, `处理失败`, `已创建`, `queued`, or `extracting` show a trash icon.
- A `可入账` / `ready` task does not show a trash icon.
- Clicking the trash icon opens a confirmation dialog.
- Confirming deletion removes the task from the recent-task list.
- In pipeline mode, the deleted task no longer appears after refresh and the corresponding R2 object key is gone.
- The `打开最近任务` button points to the next newest remaining task after deletion.

- [ ] **Step 5: Commit verification fixes if needed**

If verification required any fixes:

```bash
git add <changed-files>
git commit -m "fix: stabilize invoice task deletion"
```

---

## Notes and Edge Cases

- Do not delete `ready` jobs. They may already have `invoices`, `invoice_items`, and `ledger_entries` records that reference the intake job.
- R2 deletion must happen in the server mutation, not only through UI state removal.
- Missing jobs are treated as idempotent success because the user goal is "make this task gone from recent tasks".
- Queue messages for already-deleted jobs must not retry forever. Returning `{ stage: 'deleted' }` lets `src/server.ts` acknowledge the message.
- The UI should not put a delete button inside a full-card `<Link>`. Use an explicit link area plus separate icon button to avoid nested interactive controls.
