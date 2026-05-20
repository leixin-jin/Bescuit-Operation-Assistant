# Invoice Booked Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a user successfully clicks `确认入账`, the invoice status shown in the recent-task list and review header should read `已入账` and use a green badge.

**Architecture:** Keep the existing status model: `readinessSummary.isReady` means the current draft can be submitted, while `job.status === 'ready'` / `job.stage === 'ready'` means the invoice has already been confirmed and accounting rows have been written. This plan only changes presentation labels and badge styling, not database schema or confirmation semantics.

**Tech Stack:** React, TanStack Router, TanStack Form, TanStack Query, Vitest, Testing Library, Tailwind utility classes.

---

## File Structure

- Modify: `src/lib/server/app-domain.ts`
  - Responsibility: central status label mapping. Change `ready` from `可入账` to `已入账`.
- Modify: `src/routes/invoices/new.tsx`
  - Responsibility: recent-task list UI. Render `ready` invoice badges with green success styling.
- Modify: `src/routes/invoices/review/$jobId.tsx`
  - Responsibility: review page header UI. Render the main status badge as green when the persisted job status is `ready`.
- Modify: `src/tests/invoice-mock-store.test.ts`
  - Responsibility: unit-level assertion for the canonical status label.
- Modify: `src/tests/router.smoke.test.tsx`
  - Responsibility: route-level UI assertion that a ready invoice appears as green `已入账` in the recent-task list.

---

### Task 1: Lock The Canonical `ready` Label

**Files:**
- Modify: `src/tests/invoice-mock-store.test.ts`
- Modify: `src/lib/server/app-domain.ts`

- [ ] **Step 1: Write the failing label test**

In `src/tests/invoice-mock-store.test.ts`, update the import from `@/features/invoices/mock-store` to include `getStatusLabel`:

```ts
import {
  createInvoiceJob,
  deleteInvoiceJob,
  getInvoiceJob,
  getInvoiceReadinessSummary,
  getStatusLabel,
  listInvoiceJobs,
  saveInvoiceJob,
} from '@/features/invoices/mock-store'
```

Add this test near the top of the `describe('invoice mock store', () => { ... })` block, after `beforeEach`:

```ts
  test('ready invoice jobs are labelled as booked', () => {
    expect(getStatusLabel('ready')).toBe('已入账')
  })
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm vitest run src/tests/invoice-mock-store.test.ts
```

Expected result before implementation:

```text
FAIL src/tests/invoice-mock-store.test.ts
Expected: "已入账"
Received: "可入账"
```

- [ ] **Step 3: Change the canonical label**

In `src/lib/server/app-domain.ts`, change the `ready` branch in `getInvoiceStatusLabel`:

```ts
export function getInvoiceStatusLabel(status: InvoiceJobStatus) {
  switch (status) {
    case 'uploaded':
      return '已创建'
    case 'error':
      return '处理失败'
    case 'ready':
      return '已入账'
    default:
      return '待核对'
  }
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
pnpm vitest run src/tests/invoice-mock-store.test.ts
```

Expected result:

```text
✓ src/tests/invoice-mock-store.test.ts
```

- [ ] **Step 5: Commit the label change**

Run:

```bash
git add src/lib/server/app-domain.ts src/tests/invoice-mock-store.test.ts
git commit -m "fix: label booked invoices as entered"
```

---

### Task 2: Make Recent-Task `已入账` Badges Green

**Files:**
- Modify: `src/tests/router.smoke.test.tsx`
- Modify: `src/routes/invoices/new.tsx`

- [ ] **Step 1: Write the failing recent-task badge test**

In `src/tests/router.smoke.test.tsx`, update the import from `@/features/invoices/mock-store`:

```ts
import { createInvoiceJob, saveInvoiceJob } from '@/features/invoices/mock-store'
```

Add this test near the existing invoice route smoke tests:

```tsx
  test('invoice intake recent tasks show booked jobs with a green status badge', async () => {
    const job = await createInvoiceJob('booked-upload.pdf')

    await saveInvoiceJob({
      ...job,
      stage: 'ready',
      status: 'ready',
      header: {
        supplier: 'VINOS ISABEL MARIA CRUSAT SA',
        invoiceNo: 'FP26020968',
        date: '2026-04-21',
        totalAmount: '106.67',
        taxAmount: '18.51',
        notes: '',
      },
    })

    await renderRoute('/invoices/new')

    const taskCard = screen.getByText('booked-upload.pdf').closest('div')
    expect(taskCard).toBeTruthy()

    const bookedBadge = Array.from(taskCard!.querySelectorAll('*')).find(
      (element) => element.textContent === '已入账',
    )

    expect(bookedBadge).toBeTruthy()
    expect(bookedBadge!.className).toContain('bg-emerald-100')
    expect(bookedBadge!.className).toContain('text-emerald-700')
  })
```

- [ ] **Step 2: Run the route smoke test and verify the styling assertion fails**

Run:

```bash
pnpm vitest run src/tests/router.smoke.test.tsx
```

Expected result before implementation:

```text
FAIL src/tests/router.smoke.test.tsx
expected className to contain "bg-emerald-100"
```

- [ ] **Step 3: Apply green styling to ready recent-task badges**

In `src/routes/invoices/new.tsx`, replace the recent-task badge at the current `getInvoiceStatusLabel(job.status)` render site with:

```tsx
                        <Badge
                          variant="secondary"
                          className={
                            job.status === 'ready'
                              ? 'rounded-lg bg-emerald-100 text-emerald-700'
                              : 'rounded-lg'
                          }
                        >
                          {getInvoiceStatusLabel(job.status)}
                        </Badge>
```

- [ ] **Step 4: Run the route smoke test and verify it passes**

Run:

```bash
pnpm vitest run src/tests/router.smoke.test.tsx
```

Expected result:

```text
✓ src/tests/router.smoke.test.tsx
```

- [ ] **Step 5: Commit the recent-task UI change**

Run:

```bash
git add src/routes/invoices/new.tsx src/tests/router.smoke.test.tsx
git commit -m "fix: show booked invoice badges in green"
```

---

### Task 3: Align The Review Header Status Badge

**Files:**
- Modify: `src/routes/invoices/review/$jobId.tsx`
- Modify: `src/tests/invoice-review-rehydration.test.tsx`

- [ ] **Step 1: Write the failing review-header status test**

In `src/tests/invoice-review-rehydration.test.tsx`, inside the mocked `getInvoiceReviewPageData`, add a branch before the default return:

```ts
      if (jobId === 'booked-review-job') {
        return {
          job: {
            jobId,
            fileName: 'booked-review.pdf',
            uploadedAt: '2026-04-24T11:00:00.000Z',
            pageCount: 1,
            status: 'ready' as const,
            stage: 'ready' as const,
            errorMessage: null,
            header: {
              supplier: 'VINOS ISABEL MARIA CRUSAT SA',
              invoiceNo: 'FP26020968',
              date: '2026-04-21',
              totalAmount: '106.67',
              taxAmount: '18.51',
              notes: '',
            },
            lineItems: [
              {
                id: 'line-booked-1',
                name: 'ESTRELLA GALICIA 24x33 cl. RET',
                qty: '4.00',
                unit: 'unidad',
                unitPrice: '25.61',
                lineTotal: '102.45',
                taxRate: '21%',
                notes: '',
                ingredient: '',
                matched: false,
              },
            ],
          },
          ingredientOptions: actual.ingredientOptions,
        }
      }
```

Add this test near the other review route hydration tests:

```tsx
  test('shows booked review jobs with a green header status badge', async () => {
    await renderRoute('/invoices/review/booked-review-job')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '发票核对' })).toBeTruthy()
    })

    const bookedBadge = screen.getByText('已入账')

    expect(bookedBadge.className).toContain('bg-emerald-100')
    expect(bookedBadge.className).toContain('text-emerald-700')
  })
```

- [ ] **Step 2: Run the review hydration test and verify the styling assertion fails**

Run:

```bash
pnpm vitest run src/tests/invoice-review-rehydration.test.tsx
```

Expected result before implementation:

```text
FAIL src/tests/invoice-review-rehydration.test.tsx
expected className to contain "bg-emerald-100"
```

- [ ] **Step 3: Apply green styling to the review page status badge**

In `src/routes/invoices/review/$jobId.tsx`, replace the header status badge at the current `getInvoiceStatusLabel(editableJob.status)` render site with:

```tsx
                        <Badge
                          variant="secondary"
                          className={
                            editableJob.status === 'ready'
                              ? 'rounded-lg bg-emerald-100 text-emerald-700'
                              : 'rounded-lg'
                          }
                        >
                          {getInvoiceStatusLabel(editableJob.status)}
                        </Badge>
```

- [ ] **Step 4: Run the review hydration test and verify it passes**

Run:

```bash
pnpm vitest run src/tests/invoice-review-rehydration.test.tsx
```

Expected result:

```text
✓ src/tests/invoice-review-rehydration.test.tsx
```

- [ ] **Step 5: Commit the review header UI change**

Run:

```bash
git add 'src/routes/invoices/review/$jobId.tsx' src/tests/invoice-review-rehydration.test.tsx
git commit -m "fix: show booked review status in green"
```

---

### Task 4: Final Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run the focused invoice/status tests**

Run:

```bash
pnpm vitest run src/tests/invoice-mock-store.test.ts src/tests/router.smoke.test.tsx src/tests/invoice-review-rehydration.test.tsx src/tests/real-data-integration.test.ts
```

Expected result:

```text
Test Files  4 passed
```

- [ ] **Step 2: Run a production build**

Run:

```bash
pnpm run build
```

Expected result:

```text
✓ built
```

- [ ] **Step 3: Manual browser verification**

Run the app:

```bash
pnpm run dev
```

Open:

```text
http://localhost:3000/invoices/new
```

Manual checks:

- Upload or open a review task.
- Fill required fields: supplier, invoice number, invoice date, total amount, tax amount.
- Click `确认入账`.
- Confirm the review page feedback still says `发票已确认，后续可进入入账链路。`.
- Return to `/invoices/new`.
- Confirm the recent-task status badge says `已入账`.
- Confirm that badge is green.
- Re-open the same task.
- Confirm the review header status badge says `已入账` and is green.

- [ ] **Step 4: Commit final verification fixes if any were needed**

Only run this if Step 1 or Step 2 required small corrective edits:

```bash
git add src/lib/server/app-domain.ts src/routes/invoices/new.tsx 'src/routes/invoices/review/$jobId.tsx' src/tests/invoice-mock-store.test.ts src/tests/router.smoke.test.tsx src/tests/invoice-review-rehydration.test.tsx
git commit -m "fix: align invoice booked status display"
```

If no corrective edits were needed, do not create another commit.

---

## Self-Review

**Spec coverage:** The user wants the previous page status after successful booking to show green `已入账`. Task 1 changes the canonical label, Task 2 makes the previous page recent-task badge green, and Task 3 keeps the review page header consistent.

**Placeholder scan:** No placeholders remain. Every code step includes the exact snippet to add or replace.

**Type consistency:** The plan uses existing `InvoiceJobStatus` value `ready`; it does not introduce a new status or schema migration. This matches current confirmation behavior in `confirmInvoiceReviewJobInDatabase`, where confirmed invoices set `intake_jobs.stage = 'ready'` and write accounting rows.
