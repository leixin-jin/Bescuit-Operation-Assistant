# Entry Completion Toast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a reminder toast for 3 seconds after successful completion actions in 营业额输入 and 发票核对.

**Architecture:** Reuse the existing Radix toast stack already mounted through `src/routes/__root.tsx` and `src/components/ui/toaster.tsx`. Add a small shared helper so all target pages call the same 3-second success toast behavior without changing persistence logic.

**Tech Stack:** React 19, TanStack Router/Form/Query, Radix Toast via existing `useToast`, Vitest, Testing Library.

---

## File Structure

- Create: `src/lib/entry-completion-toast.ts`
  - Owns the common toast duration and message helper for successful input completion.
- Modify: `src/routes/sales/new.tsx`
  - Calls the shared helper after successful draft save or final submit.
- Modify: `src/routes/invoices/new.tsx`
  - Calls the shared helper after invoice intake task creation finishes successfully.
- Modify: `src/routes/invoices/review/$jobId.tsx`
  - Calls the shared helper after invoice review draft save or confirm succeeds.
- Modify: `src/tests/router.smoke.test.tsx`
  - Covers the sales entry success toast.
- Modify: `src/tests/invoice-intake-rehydration.test.tsx`
  - Covers the invoice intake success toast.
- Modify: `src/tests/invoice-review-rehydration.test.tsx`
  - Covers the invoice review success toast.

## Task 1: Add Shared 3-Second Toast Helper

**Files:**
- Create: `src/lib/entry-completion-toast.ts`

- [ ] **Step 1: Create the helper**

Create `src/lib/entry-completion-toast.ts`:

```ts
import { toast } from '@/hooks/use-toast'

export const ENTRY_COMPLETION_TOAST_DURATION_MS = 3000

export function showEntryCompletionToast(message: string) {
  toast({
    title: '输入完成',
    description: message,
    duration: ENTRY_COMPLETION_TOAST_DURATION_MS,
  })
}
```

- [ ] **Step 2: Run typecheck through the existing test command**

Run:

```bash
pnpm vitest run src/tests/router.smoke.test.tsx
```

Expected: this may still pass unchanged; if it fails from the new import path, fix the alias/import before moving on.

- [ ] **Step 3: Commit**

```bash
git add src/lib/entry-completion-toast.ts
git commit -m "feat: add entry completion toast helper"
```

## Task 2: Add Toasts To Sales Entry

**Files:**
- Modify: `src/routes/sales/new.tsx`
- Modify: `src/tests/router.smoke.test.tsx`

- [ ] **Step 1: Write the failing sales UI test**

In `src/tests/router.smoke.test.tsx`, add this test inside `describe('phase 1-4 smoke tests', () => { ... })` after the existing sales entry tests:

```tsx
test('sales entry shows a 3 second completion toast after submit', async () => {
  vi.useFakeTimers()

  try {
    await renderRoute('/sales/new')

    fireEvent.change(screen.getByLabelText('TOTAL'), {
      target: { value: '100' },
    })
    fireEvent.change(screen.getByLabelText('BBVA'), {
      target: { value: '35.50' },
    })
    fireEvent.change(screen.getByLabelText('CAIXA'), {
      target: { value: '20' },
    })
    fireEvent.click(screen.getByRole('button', { name: /确认提交/ }))

    expect(await screen.findByText('输入完成')).toBeTruthy()
    expect(screen.getByText('今日营业额已提交。')).toBeTruthy()

    await act(async () => {
      vi.advanceTimersByTime(3000)
    })

    await waitFor(() => {
      expect(screen.queryByText('输入完成')).toBeNull()
    })
  } finally {
    vi.useRealTimers()
  }
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
pnpm vitest run src/tests/router.smoke.test.tsx -t "sales entry shows a 3 second completion toast after submit"
```

Expected: FAIL because no toast is shown yet.

- [ ] **Step 3: Add the toast call to sales success handling**

In `src/routes/sales/new.tsx`, add this import:

```ts
import { showEntryCompletionToast } from '@/lib/entry-completion-toast'
```

Then replace the current success message assignment:

```ts
setFeedbackMessage(
  variables.mode === 'draft' ? '营业额草稿已保存。' : '今日营业额已提交。',
)
```

with:

```ts
const successMessage =
  variables.mode === 'draft' ? '营业额草稿已保存。' : '今日营业额已提交。'

setFeedbackMessage(successMessage)
showEntryCompletionToast(successMessage)
```

- [ ] **Step 4: Run the focused sales test**

Run:

```bash
pnpm vitest run src/tests/router.smoke.test.tsx -t "sales entry shows a 3 second completion toast after submit"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/sales/new.tsx src/tests/router.smoke.test.tsx
git commit -m "feat: show sales completion toast"
```

## Task 3: Add Toasts To Invoice Intake

**Files:**
- Modify: `src/routes/invoices/new.tsx`
- Modify: `src/tests/invoice-intake-rehydration.test.tsx`

- [ ] **Step 1: Write the failing invoice intake test**

In `src/tests/invoice-intake-rehydration.test.tsx`, add this test inside `describe('invoice intake route hydration', () => { ... })`:

```tsx
test('invoice intake shows a 3 second completion toast after creating a task', async () => {
  vi.useFakeTimers()

  try {
    await renderRoute('/invoices/new')

    const file = new File(['invoice bytes'], 'toast-invoice.pdf', {
      type: 'application/pdf',
    })
    const input = document.querySelector('#invoice-file') as HTMLInputElement

    fireEvent.change(input, {
      target: { files: [file] },
    })
    fireEvent.click(screen.getByRole('button', { name: /创建任务/ }))

    expect(await screen.findByText('输入完成')).toBeTruthy()
    expect(screen.getByText('发票任务已创建。')).toBeTruthy()

    await act(async () => {
      vi.advanceTimersByTime(3000)
    })

    await waitFor(() => {
      expect(screen.queryByText('输入完成')).toBeNull()
    })
  } finally {
    vi.useRealTimers()
  }
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
pnpm vitest run src/tests/invoice-intake-rehydration.test.tsx -t "invoice intake shows a 3 second completion toast after creating a task"
```

Expected: FAIL because no intake toast is shown yet.

- [ ] **Step 3: Add the toast call after successful job creation**

In `src/routes/invoices/new.tsx`, add this import:

```ts
import { showEntryCompletionToast } from '@/lib/entry-completion-toast'
```

In `handleCreateJobs`, after the `for (const item of validFiles) { ... }` loop and before the final `await Promise.all([...])`, add:

```ts
const createdCount = selectedFiles.filter((item) => item.status === 'created').length
const nextCreatedCount = createdCount + validFiles.length

showEntryCompletionToast(
  nextCreatedCount > 1
    ? `${validFiles.length} 个发票任务已创建。`
    : '发票任务已创建。',
)
```

If some files fail, revise this block to count only successful `mutateAsync` calls:

```ts
let successCount = 0

for (const item of validFiles) {
  // existing per-file upload code
  try {
    const result = await createJobMutation.mutateAsync(item.file)
    successCount += 1
    // existing state update
  } catch (error) {
    // existing error state update
  }
}

if (successCount > 0) {
  showEntryCompletionToast(
    successCount > 1 ? `${successCount} 个发票任务已创建。` : '发票任务已创建。',
  )
}
```

- [ ] **Step 4: Run the focused intake test**

Run:

```bash
pnpm vitest run src/tests/invoice-intake-rehydration.test.tsx -t "invoice intake shows a 3 second completion toast after creating a task"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/invoices/new.tsx src/tests/invoice-intake-rehydration.test.tsx
git commit -m "feat: show invoice intake completion toast"
```

## Task 4: Add Toasts To Invoice Review

**Files:**
- Modify: `src/routes/invoices/review/$jobId.tsx`
- Modify: `src/tests/invoice-review-rehydration.test.tsx`

- [ ] **Step 1: Write the failing invoice review test**

In `src/tests/invoice-review-rehydration.test.tsx`, add this test inside the existing `describe` block:

```tsx
test('invoice review shows a 3 second completion toast after saving a draft', async () => {
  vi.useFakeTimers()

  try {
    await renderRoute('/invoices/review/rehydrated-review-job')

    expect(await screen.findByRole('heading', { name: '发票核对' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /保存草稿/ }))

    expect(await screen.findByText('输入完成')).toBeTruthy()
    expect(screen.getByText('发票草稿已保存。')).toBeTruthy()

    await act(async () => {
      vi.advanceTimersByTime(3000)
    })

    await waitFor(() => {
      expect(screen.queryByText('输入完成')).toBeNull()
    })
  } finally {
    vi.useRealTimers()
  }
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
pnpm vitest run src/tests/invoice-review-rehydration.test.tsx -t "invoice review shows a 3 second completion toast after saving a draft"
```

Expected: FAIL because no review toast is shown yet.

- [ ] **Step 3: Add the toast call to invoice review success handling**

In `src/routes/invoices/review/$jobId.tsx`, add this import:

```ts
import { showEntryCompletionToast } from '@/lib/entry-completion-toast'
```

Then replace the current success message assignment:

```ts
setFeedbackMessage(
  result.mode === 'draft'
    ? '发票草稿已保存。'
    : result.ok
      ? '发票已确认，后续可进入入账链路。'
      : '仍有阻塞项，暂不能确认入账。',
)
```

with:

```ts
const successMessage =
  result.mode === 'draft'
    ? '发票草稿已保存。'
    : result.ok
      ? '发票已确认，后续可进入入账链路。'
      : '仍有阻塞项，暂不能确认入账。'

setFeedbackMessage(successMessage)

if (result.mode === 'draft' || result.ok) {
  showEntryCompletionToast(successMessage)
}
```

This keeps the blocking confirmation message inline only, because that is not a completed input.

- [ ] **Step 4: Run the focused review test**

Run:

```bash
pnpm vitest run src/tests/invoice-review-rehydration.test.tsx -t "invoice review shows a 3 second completion toast after saving a draft"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/invoices/review/\$jobId.tsx src/tests/invoice-review-rehydration.test.tsx
git commit -m "feat: show invoice review completion toast"
```

## Task 5: Full Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run focused UI coverage**

Run:

```bash
pnpm vitest run src/tests/router.smoke.test.tsx src/tests/invoice-intake-rehydration.test.tsx src/tests/invoice-review-rehydration.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run project smoke suite**

Run:

```bash
pnpm smoke
```

Expected: PASS.

- [ ] **Step 3: Manual browser verification**

Run:

```bash
pnpm dev
```

Open:

```text
http://localhost:3000/sales/new
http://localhost:3000/invoices/new
```

Verify:

- Submitting sales shows a toast titled `输入完成`.
- Creating an invoice task shows a toast titled `输入完成`.
- Saving invoice review draft shows a toast titled `输入完成`.
- Each toast visually closes after about 3 seconds.
- Existing inline feedback messages still render where they did before.

- [ ] **Step 4: Final commit**

If previous task commits were not made, make one final commit:

```bash
git add src/lib/entry-completion-toast.ts src/routes/sales/new.tsx src/routes/invoices/new.tsx src/routes/invoices/review/\$jobId.tsx src/tests/router.smoke.test.tsx src/tests/invoice-intake-rehydration.test.tsx src/tests/invoice-review-rehydration.test.tsx
git commit -m "feat: show entry completion reminders"
```

## Self-Review

- Spec coverage: The plan covers 营业额输入 after save/submit and 发票核对 after intake creation plus review save/confirm.
- Duration: The shared helper pins the toast duration to `3000` ms.
- Scope: No database, server mutation, schema, or routing changes are needed.
- Risk: Tests that use fake timers may need `act` around timer advancement because Radix Toast owns the close timer internally.
