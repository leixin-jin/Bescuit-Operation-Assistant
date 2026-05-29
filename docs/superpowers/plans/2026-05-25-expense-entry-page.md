# Expense Entry Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `支出录入` page where a user can record one supplier expense for a selected business date, with supplier selection from previous invoice suppliers or free-text entry.

**Architecture:** Reuse the existing `ledger_entries` table as the source of truth for expenses because analytics and calendar pages already read expenses from it. Add a small manual-expense domain/query/mutation layer, then build a TanStack Router page that mirrors the existing `/sales/new` form structure.

**Tech Stack:** TanStack Router, TanStack Form, TanStack Query, TanStack Start server functions, Cloudflare D1, Drizzle schema, Vitest, Testing Library.

---

## File Structure

- Create: `migrations/0003_manual_expense_notes.sql`
  - Adds `note` to `ledger_entries` so the optional remark has durable storage.
- Modify: `src/lib/db/schema.ts`
  - Adds `ledgerEntries.note`.
- Modify: `src/lib/server/app-domain.ts`
  - Adds manual expense input/record types and normalizers.
- Create: `src/lib/server/queries/expenses.ts`
  - Loads the selected date, distinct supplier options from `invoices.supplier_name`, and recent expenses for the selected date.
- Create: `src/lib/server/mutations/expenses.ts`
  - Inserts one manual `ledger_entries` expense.
- Create: `src/routes/expenses/new.tsx`
  - New `支出录入` page.
- Modify: `src/components/app-sidebar.tsx`
  - Adds sidebar navigation item for `/expenses/new`.
- Modify: `src/routeTree.gen.ts`
  - Regenerate route tree after creating the route.
- Modify: `src/tests/router.smoke.test.tsx`
  - Adds smoke coverage for page rendering and navigation.
- Create: `src/tests/expense-entry.test.ts`
  - Unit coverage for input normalization.
- Modify: `src/tests/real-data-integration.test.ts`
  - Integration coverage for inserting manual expense into `ledger_entries`.
- Modify: `agent.md`
  - Adds the new route and workflow description.

## Product Decisions

- A submission creates one expense row, not a draft and not an upsert by date. Multiple suppliers can be recorded for the same day.
- Supplier input uses a normal text input with a `<datalist>` populated from distinct `invoices.supplier_name`; any new supplier text is accepted.
- The page shows recent expenses for the selected date after submission so the user can confirm what was entered.
- Manual expenses use `entry_type='expense'`, `category='manual'`, `source_kind='manual'`, and a generated `source_id` matching the row id.
- Analytics and calendar pages need no query changes because they already read every `ledger_entries` expense.

## Task 1: Add Manual Expense Domain Helpers

**Files:**
- Modify: `src/lib/server/app-domain.ts`
- Test: `src/tests/expense-entry.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `src/tests/expense-entry.test.ts`:

```ts
import { describe, expect, test } from 'vitest'

import {
  normalizeManualExpenseInput,
  type ManualExpenseDraftInput,
} from '@/lib/server/app-domain'

describe('manual expense entry helpers', () => {
  test('normalizes a valid manual expense', () => {
    const input: ManualExpenseDraftInput = {
      date: '2026-05-25',
      supplierName: ' Makro Madrid ',
      amount: '42.105',
      note: '  compra urgente  ',
    }

    expect(normalizeManualExpenseInput(input, '2026-05-25T10:00:00.000Z')).toMatchObject({
      id: 'manual-expense-2026-05-25-1000000000',
      entryDate: '2026-05-25',
      amount: 42.11,
      vendor: 'Makro Madrid',
      note: 'compra urgente',
      sourceKind: 'manual',
      sourceId: 'manual-expense-2026-05-25-1000000000',
    })
  })

  test('rejects blank supplier names', () => {
    expect(() =>
      normalizeManualExpenseInput({
        date: '2026-05-25',
        supplierName: '   ',
        amount: '12',
        note: '',
      }),
    ).toThrow('供应商不能为空')
  })

  test('rejects zero and negative amounts', () => {
    expect(() =>
      normalizeManualExpenseInput({
        date: '2026-05-25',
        supplierName: 'Makro Madrid',
        amount: '0',
        note: '',
      }),
    ).toThrow('支出金额必须大于 0')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run src/tests/expense-entry.test.ts
```

Expected: FAIL because `normalizeManualExpenseInput` and `ManualExpenseDraftInput` do not exist.

- [ ] **Step 3: Add domain types and normalizer**

In `src/lib/server/app-domain.ts`, add these exports near the sales types:

```ts
export interface ManualExpenseDraftInput {
  date: string
  supplierName: string
  amount: string
  note: string
}

export interface ManualExpenseRecord {
  id: string
  entryDate: string
  entryType: 'expense'
  category: 'manual'
  amount: number
  vendor: string
  note: string
  sourceKind: 'manual'
  sourceId: string
  createdAt: string
}

export interface ExpenseEntryPageData {
  date: string
  supplierOptions: string[]
  recentExpenses: ManualExpenseRecord[]
}

export function normalizeManualExpenseInput(
  input: ManualExpenseDraftInput,
  createdAt = new Date().toISOString(),
): ManualExpenseRecord {
  const entryDate = input.date.trim()
  const vendor = input.supplierName.trim()
  const amount = parseCurrencyAmount(input.amount)

  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
    throw new Error('日期格式无效')
  }

  if (!vendor) {
    throw new Error('供应商不能为空')
  }

  if (amount <= 0) {
    throw new Error('支出金额必须大于 0')
  }

  const id = `manual-expense-${entryDate}-${Date.parse(createdAt)}`

  return {
    id,
    entryDate,
    entryType: 'expense',
    category: 'manual',
    amount,
    vendor,
    note: input.note.trim(),
    sourceKind: 'manual',
    sourceId: id,
    createdAt,
  }
}
```

- [ ] **Step 4: Run unit test**

Run:

```bash
pnpm vitest run src/tests/expense-entry.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/app-domain.ts src/tests/expense-entry.test.ts
git commit -m "feat: add manual expense domain helpers"
```

## Task 2: Add Storage Support For Notes

**Files:**
- Create: `migrations/0003_manual_expense_notes.sql`
- Modify: `src/lib/db/schema.ts`
- Modify: `src/tests/real-data-integration.test.ts`

- [ ] **Step 1: Add migration**

Create `migrations/0003_manual_expense_notes.sql`:

```sql
ALTER TABLE `ledger_entries`
  ADD COLUMN `note` text NOT NULL DEFAULT '';
```

- [ ] **Step 2: Update Drizzle schema**

In `src/lib/db/schema.ts`, add `note` after `vendor`:

```ts
    note: text('note').notNull().default(''),
```

- [ ] **Step 3: Update fake D1 test row shape**

In `src/tests/real-data-integration.test.ts`, extend `LedgerEntryRow` with:

```ts
  note: string
```

When existing invoice-ledger tests create or assert rows, set or expect `note: ''`.

- [ ] **Step 4: Run integration tests that touch ledger rows**

Run:

```bash
pnpm vitest run src/tests/real-data-integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add migrations/0003_manual_expense_notes.sql src/lib/db/schema.ts src/tests/real-data-integration.test.ts
git commit -m "feat: store manual expense notes"
```

## Task 3: Add Expense Queries And Mutations

**Files:**
- Create: `src/lib/server/queries/expenses.ts`
- Create: `src/lib/server/mutations/expenses.ts`
- Modify: `src/tests/real-data-integration.test.ts`

- [ ] **Step 1: Write failing integration test**

In `src/tests/real-data-integration.test.ts`, add:

```ts
test('manual expense entry inserts ledger expense with supplier and note', async () => {
  const env = createTestEnv({
    invoices: [
      {
        id: 'inv-existing',
        intake_job_id: null,
        invoice_date: '2026-05-20',
        supplier_name: 'Makro Madrid',
        document_number: 'MK-1',
        subtotal_amount: null,
        tax_amount: 0,
        total_amount: 100,
        payment_method: null,
        currency: 'EUR',
        source_document_id: null,
        review_status: 'ready',
        created_at: '2026-05-20T10:00:00.000Z',
        updated_at: '2026-05-20T10:00:00.000Z',
      },
    ],
    ledger_entries: [],
  })

  const { getExpenseEntryPageData } = await import('@/lib/server/queries/expenses')
  const { createManualExpense } = await import('@/lib/server/mutations/expenses')

  await expect(getExpenseEntryPageData(env, '2026-05-25')).resolves.toMatchObject({
    date: '2026-05-25',
    supplierOptions: ['Makro Madrid'],
    recentExpenses: [],
  })

  await createManualExpense(env, {
    date: '2026-05-25',
    supplierName: 'Makro Madrid',
    amount: '42.10',
    note: 'late delivery',
  })

  expect(env.DB.tables.ledger_entries).toHaveLength(1)
  expect(env.DB.tables.ledger_entries[0]).toMatchObject({
    entry_date: '2026-05-25',
    entry_type: 'expense',
    category: 'manual',
    amount: 42.1,
    vendor: 'Makro Madrid',
    note: 'late delivery',
    source_kind: 'manual',
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run src/tests/real-data-integration.test.ts --testNamePattern "manual expense entry"
```

Expected: FAIL because `queries/expenses` and `mutations/expenses` do not exist.

- [ ] **Step 3: Create expense query server functions**

Create `src/lib/server/queries/expenses.ts`:

```ts
import { createServerFn } from '@tanstack/react-start'

import {
  getMadridTodayInputValue,
  type ExpenseEntryPageData,
  type ManualExpenseRecord,
} from '@/lib/server/app-domain'
import { getServerEnv, type AppBindings } from '@/lib/server/bindings'
import { allD1, requireD1Database } from '@/lib/server/d1'
import { assertDemoDataEnabled } from '@/lib/server/runtime-config'

interface ManualExpenseRow {
  id: string
  entryDate: string
  amount: number
  vendor: string | null
  note: string
  sourceId: string
  createdAt: string
}

export const getExpenseEntryPageDataServerFn = createServerFn({ method: 'GET' })
  .inputValidator((data: { date?: string } | undefined) => data ?? {})
  .handler(async ({ data, context }) =>
    getExpenseEntryPageData(getServerEnv(context), data?.date),
  )

export async function getExpenseEntryPageData(
  envOrDate?: Partial<AppBindings> | string | null,
  maybeDate?: string,
): Promise<ExpenseEntryPageData> {
  const { env, date } = resolveExpenseQueryArgs(envOrDate, maybeDate)

  if (!env?.DB) {
    assertDemoDataEnabled(env, 'expenses')
    return { date, supplierOptions: [], recentExpenses: [] }
  }

  const [supplierOptions, recentExpenses] = await Promise.all([
    listSupplierOptionsFromDatabase(env),
    listManualExpensesForDateFromDatabase(env, date),
  ])

  return { date, supplierOptions, recentExpenses }
}

async function listSupplierOptionsFromDatabase(env: Partial<AppBindings>) {
  const db = requireD1Database(env, 'expenses')
  const rows = await allD1<{ supplierName: string }>(
    db,
    `/* expenses:supplier-options */
    SELECT DISTINCT supplier_name AS supplierName
    FROM invoices
    WHERE TRIM(supplier_name) <> ''
    ORDER BY supplier_name COLLATE NOCASE ASC`,
  )

  return rows.map((row) => row.supplierName)
}

async function listManualExpensesForDateFromDatabase(
  env: Partial<AppBindings>,
  date: string,
) {
  const db = requireD1Database(env, 'expenses')
  const rows = await allD1<ManualExpenseRow>(
    db,
    `/* expenses:list-manual-by-date */
    SELECT
      id,
      entry_date AS entryDate,
      amount,
      vendor,
      note,
      source_id AS sourceId,
      created_at AS createdAt
    FROM ledger_entries
    WHERE entry_type = 'expense'
      AND source_kind = 'manual'
      AND entry_date = ?
    ORDER BY created_at DESC`,
    [date],
  )

  return rows.map(toManualExpenseRecord)
}

function toManualExpenseRecord(row: ManualExpenseRow): ManualExpenseRecord {
  return {
    id: row.id,
    entryDate: row.entryDate,
    entryType: 'expense',
    category: 'manual',
    amount: row.amount,
    vendor: row.vendor ?? '',
    note: row.note,
    sourceKind: 'manual',
    sourceId: row.sourceId,
    createdAt: row.createdAt,
  }
}

function resolveExpenseQueryArgs(
  envOrDate: Partial<AppBindings> | string | null | undefined,
  maybeDate: string | undefined,
) {
  if (typeof envOrDate === 'string') {
    return { env: undefined, date: envOrDate }
  }

  return {
    env: envOrDate ?? undefined,
    date: maybeDate ?? getMadridTodayInputValue(),
  }
}
```

- [ ] **Step 4: Create expense mutation server function**

Create `src/lib/server/mutations/expenses.ts`:

```ts
import { createServerFn } from '@tanstack/react-start'

import {
  normalizeManualExpenseInput,
  type ManualExpenseDraftInput,
} from '@/lib/server/app-domain'
import { getServerEnv, type AppBindings } from '@/lib/server/bindings'
import { requireD1Database, runD1 } from '@/lib/server/d1'
import { assertDemoDataEnabled } from '@/lib/server/runtime-config'

export const createManualExpenseServerFn = createServerFn({ method: 'POST' })
  .inputValidator((data: ManualExpenseDraftInput) => data)
  .handler(async ({ data, context }) =>
    createManualExpense(getServerEnv(context), data),
  )

export async function createManualExpense(
  envOrInput: Partial<AppBindings> | ManualExpenseDraftInput | null | undefined,
  maybeInput?: ManualExpenseDraftInput,
) {
  const { env, input } = resolveExpenseMutationArgs(envOrInput, maybeInput)
  const record = normalizeManualExpenseInput(input)

  if (!env?.DB) {
    assertDemoDataEnabled(env, 'expenses')
    return record
  }

  const db = requireD1Database(env, 'expenses')
  await runD1(
    db,
    `/* expenses:insert-manual */
    INSERT INTO ledger_entries (
      id,
      entry_date,
      entry_type,
      category,
      amount,
      vendor,
      note,
      source_kind,
      source_id,
      created_at
    )
    VALUES (?, ?, 'expense', 'manual', ?, ?, ?, 'manual', ?, ?)`,
    [
      record.id,
      record.entryDate,
      record.amount,
      record.vendor,
      record.note,
      record.sourceId,
      record.createdAt,
    ],
  )

  return record
}

function resolveExpenseMutationArgs(
  envOrInput: Partial<AppBindings> | ManualExpenseDraftInput | null | undefined,
  maybeInput: ManualExpenseDraftInput | undefined,
) {
  if (maybeInput) {
    return {
      env: envOrInput as Partial<AppBindings> | null | undefined,
      input: maybeInput,
    }
  }

  return {
    env: undefined,
    input: envOrInput as ManualExpenseDraftInput,
  }
}
```

- [ ] **Step 5: Extend fake D1 SQL handling**

In `src/tests/real-data-integration.test.ts`, add handlers for:

```ts
if (sql.includes('expenses:supplier-options')) {
  return Array.from(new Set(this.tables.invoices.map((row) => row.supplier_name)))
    .filter((supplierName) => supplierName.trim() !== '')
    .sort((left, right) => left.localeCompare(right))
    .map((supplierName) => ({ supplierName }))
}

if (sql.includes('expenses:list-manual-by-date')) {
  const [date] = this.params
  return this.tables.ledger_entries
    .filter(
      (row) =>
        row.entry_type === 'expense' &&
        row.source_kind === 'manual' &&
        row.entry_date === String(date),
    )
    .map((row) => ({
      id: row.id,
      entryDate: row.entry_date,
      amount: row.amount,
      vendor: row.vendor,
      note: row.note,
      sourceId: row.source_id,
      createdAt: row.created_at,
    }))
}

if (sql.includes('expenses:insert-manual')) {
  const [id, entryDate, amount, vendor, note, sourceId, createdAt] = this.params
  this.tables.ledger_entries.push({
    id: String(id),
    entry_date: String(entryDate),
    entry_type: 'expense',
    category: 'manual',
    amount: Number(amount),
    account: null,
    vendor: String(vendor),
    note: String(note),
    source_kind: 'manual',
    source_id: String(sourceId),
    created_at: String(createdAt),
  })
  return 1
}
```

- [ ] **Step 6: Run integration test**

Run:

```bash
pnpm vitest run src/tests/real-data-integration.test.ts --testNamePattern "manual expense entry"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/queries/expenses.ts src/lib/server/mutations/expenses.ts src/tests/real-data-integration.test.ts
git commit -m "feat: persist manual expense entries"
```

## Task 4: Build The `支出录入` Page

**Files:**
- Create: `src/routes/expenses/new.tsx`
- Modify: `src/components/app-sidebar.tsx`
- Modify: `src/routeTree.gen.ts`
- Modify: `src/tests/router.smoke.test.tsx`

- [ ] **Step 1: Write failing route smoke test**

In `src/tests/router.smoke.test.tsx`, add mocks:

```ts
vi.mock('@/lib/server/queries/expenses', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/queries/expenses')>()
  return {
    ...actual,
    getExpenseEntryPageDataServerFn: vi.fn(async () => ({
      date: '2026-05-25',
      supplierOptions: ['Makro Madrid', 'Bodega Local'],
      recentExpenses: [],
    })),
  }
})

vi.mock('@/lib/server/mutations/expenses', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/mutations/expenses')>()
  return {
    ...actual,
    createManualExpenseServerFn: vi.fn(async (input) => ({
      id: 'manual-expense-test',
      entryDate: input.data.date,
      entryType: 'expense',
      category: 'manual',
      amount: Number(input.data.amount),
      vendor: input.data.supplierName,
      note: input.data.note,
      sourceKind: 'manual',
      sourceId: 'manual-expense-test',
      createdAt: '2026-05-25T10:00:00.000Z',
    })),
  }
})
```

Add tests:

```ts
test('expense entry page renders supplier options and submits an expense', async () => {
  await renderRoute('/expenses/new')

  expect(await screen.findByRole('heading', { name: '支出录入' })).toBeTruthy()
  expect(screen.getByLabelText('选择日期')).toBeTruthy()
  expect(screen.getByLabelText('供应商')).toBeTruthy()
  expect(screen.getByLabelText('价格')).toBeTruthy()

  fireEvent.change(screen.getByLabelText('供应商'), {
    target: { value: 'Makro Madrid' },
  })
  fireEvent.change(screen.getByLabelText('价格'), {
    target: { value: '42.10' },
  })
  fireEvent.change(screen.getByLabelText('备注（可选）'), {
    target: { value: 'late delivery' },
  })

  fireEvent.click(screen.getByRole('button', { name: /确认提交/ }))

  expect(await screen.findByText('支出已提交。')).toBeTruthy()
})

test('sidebar links to expense entry page', async () => {
  await renderRoute('/expenses/new')

  const activeLink = await screen.findByRole('link', { name: '支出录入' })
  expect(activeLink.getAttribute('data-active')).toBe('true')
})
```

- [ ] **Step 2: Run smoke test to verify it fails**

Run:

```bash
pnpm vitest run src/tests/router.smoke.test.tsx --testNamePattern "expense entry|sidebar links to expense"
```

Expected: FAIL because `/expenses/new` does not exist.

- [ ] **Step 3: Create expense route**

Create `src/routes/expenses/new.tsx` by following the structure of `src/routes/sales/new.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { ArrowLeft, CalendarIcon, CheckCircle, Euro, ReceiptText } from 'lucide-react'

import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { getMadridTodayInputValue, type ManualExpenseRecord } from '@/lib/server/app-domain'
import { createManualExpenseServerFn } from '@/lib/server/mutations/expenses'
import { getExpenseEntryPageDataServerFn } from '@/lib/server/queries/expenses'

export const Route = createFileRoute('/expenses/new')({
  loader: () => getExpenseEntryPageDataServerFn({ data: {} }),
  component: ExpenseEntryPage,
})

interface ExpenseFormValues {
  businessDate: string
  supplierName: string
  amount: string
  note: string
}

function ExpenseEntryPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const loaderData = Route.useLoaderData() ?? createExpenseEntryPageFallbackData()
  const [businessDate, setBusinessDate] = useState(loaderData.date)
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)

  const expenseEntryQuery = useQuery({
    queryKey: ['expense-entry', businessDate],
    queryFn: async () =>
      (await getExpenseEntryPageDataServerFn({ data: { date: businessDate } })) ??
      createExpenseEntryPageFallbackData(businessDate),
    initialData: businessDate === loaderData.date ? loaderData : undefined,
  })
  const expenseEntryData = expenseEntryQuery.data ?? loaderData

  const form = useForm({
    defaultValues: createExpenseFormValues(expenseEntryData.date),
    onSubmit: async ({ value }) => {
      if (!isExpenseFormSubmittable(value)) {
        setFeedbackMessage('供应商不能为空，价格必须大于 0。')
        return
      }

      await createExpenseMutation.mutateAsync(value)
    },
  })

  const createExpenseMutation = useMutation({
    mutationFn: async (value: ExpenseFormValues) =>
      createManualExpenseServerFn({
        data: {
          date: value.businessDate,
          supplierName: value.supplierName,
          amount: value.amount,
          note: value.note,
        },
      }),
    onSuccess: async (record) => {
      form.reset(createExpenseFormValues(record.entryDate))
      setBusinessDate(record.entryDate)
      setFeedbackMessage('支出已提交。')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['expense-entry'] }),
        queryClient.invalidateQueries({ queryKey: ['monthly-analytics'] }),
        queryClient.invalidateQueries({ queryKey: ['calendar-analytics'] }),
        router.invalidate(),
      ])
    },
  })

  useEffect(() => {
    form.setFieldValue('businessDate', expenseEntryData.date)
  }, [form, expenseEntryData.date])

  return (
    <AppShell>
      <div className="p-6 lg:p-10">
        <div className="mb-8">
          <Link
            to="/"
            className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            返回首页
          </Link>
          <h1 className="text-2xl font-bold">支出录入</h1>
          <p className="mt-1 text-muted-foreground">录入某天的供应商支出</p>
        </div>

        <div className="mx-auto max-w-xl">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void form.handleSubmit()
            }}
          >
            <Card className="mb-6 rounded-xl">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarIcon className="h-4 w-4" />
                  选择日期
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form.Field
                  name="businessDate"
                  children={(field) => (
                    <Input
                      aria-label="选择日期"
                      type="date"
                      value={field.state.value}
                      onChange={(event) => {
                        field.handleChange(event.target.value)
                        setBusinessDate(event.target.value)
                      }}
                      className="rounded-lg"
                    />
                  )}
                />
              </CardContent>
            </Card>

            <Card className="mb-6 rounded-xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ReceiptText className="h-4 w-4" />
                  供应商支出
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="supplierName">供应商</Label>
                  <form.Field
                    name="supplierName"
                    children={(field) => (
                      <>
                        <Input
                          id="supplierName"
                          list="expense-supplier-options"
                          value={field.state.value}
                          onChange={(event) => field.handleChange(event.target.value)}
                          className="rounded-lg"
                        />
                        <datalist id="expense-supplier-options">
                          {expenseEntryData.supplierOptions.map((supplier) => (
                            <option key={supplier} value={supplier} />
                          ))}
                        </datalist>
                      </>
                    )}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="amount">价格</Label>
                  <div className="relative">
                    <Euro className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <form.Field
                      name="amount"
                      children={(field) => (
                        <Input
                          id="amount"
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={field.state.value}
                          onChange={(event) => {
                            if (isDecimalInput(event.target.value)) {
                              field.handleChange(event.target.value)
                            }
                          }}
                          className="rounded-lg pl-10 text-right text-lg font-medium"
                        />
                      )}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="mb-6 rounded-xl">
              <CardHeader>
                <CardTitle className="text-base">备注（可选）</CardTitle>
              </CardHeader>
              <CardContent>
                <form.Field
                  name="note"
                  children={(field) => (
                    <Textarea
                      aria-label="备注（可选）"
                      placeholder="添加备注信息..."
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      className="min-h-[100px] resize-none rounded-lg"
                    />
                  )}
                />
              </CardContent>
            </Card>

            {feedbackMessage ? (
              <div className="mb-6 rounded-xl border bg-secondary/50 px-4 py-3 text-sm text-muted-foreground">
                {feedbackMessage}
              </div>
            ) : null}

            <form.Subscribe
              selector={(state) => isExpenseFormSubmittable(state.values)}
              children={(canSubmitExpense) => (
                <Button
                  type="submit"
                  className="w-full rounded-lg"
                  disabled={createExpenseMutation.isPending || !canSubmitExpense}
                >
                  <CheckCircle className="mr-2 h-4 w-4" />
                  确认提交
                </Button>
              )}
            />
          </form>

          <RecentExpenses expenses={expenseEntryData.recentExpenses} />
        </div>
      </div>
    </AppShell>
  )
}

function RecentExpenses({ expenses }: { expenses: ManualExpenseRecord[] }) {
  if (expenses.length === 0) {
    return null
  }

  return (
    <Card className="mt-6 rounded-xl">
      <CardHeader>
        <CardTitle className="text-base">当日已录入</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {expenses.map((expense) => (
          <div key={expense.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
            <div>
              <div className="font-medium">{expense.vendor}</div>
              {expense.note ? (
                <div className="mt-1 text-sm text-muted-foreground">{expense.note}</div>
              ) : null}
            </div>
            <div className="font-semibold">€{expense.amount.toFixed(2)}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function createExpenseEntryPageFallbackData(date = getMadridTodayInputValue()) {
  return {
    date,
    supplierOptions: [],
    recentExpenses: [],
  }
}

function createExpenseFormValues(businessDate: string): ExpenseFormValues {
  return {
    businessDate,
    supplierName: '',
    amount: '',
    note: '',
  }
}

function isExpenseFormSubmittable(values: ExpenseFormValues) {
  return values.supplierName.trim().length > 0 && isCompletePositiveDecimalAmount(values.amount)
}

function isCompletePositiveDecimalAmount(value: string) {
  return /^\d+(?:\.\d+)?$/.test(value.trim()) && Number.parseFloat(value) > 0
}

function isDecimalInput(value: string) {
  return value === '' || /^\d*\.?\d*$/.test(value)
}
```

- [ ] **Step 4: Add sidebar item**

In `src/components/app-sidebar.tsx`, import `WalletCards` from `lucide-react`, then add this item after `营业额录入`:

```ts
{ title: "支出录入", href: "/expenses/new", icon: WalletCards },
```

- [ ] **Step 5: Regenerate route tree**

Run:

```bash
pnpm exec vite --host 127.0.0.1
```

Expected: Vite starts and updates `src/routeTree.gen.ts`. Stop the dev server after route generation.

If the route tree is not regenerated by the dev command, run the existing route generator through the TanStack Router plugin by starting `pnpm dev` and opening the app once.

- [ ] **Step 6: Run route smoke tests**

Run:

```bash
pnpm vitest run src/tests/router.smoke.test.tsx --testNamePattern "expense entry|sidebar links to expense"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/routes/expenses/new.tsx src/components/app-sidebar.tsx src/routeTree.gen.ts src/tests/router.smoke.test.tsx
git commit -m "feat: add expense entry page"
```

## Task 5: Documentation And Full Verification

**Files:**
- Modify: `agent.md`

- [ ] **Step 1: Update route table**

In `agent.md`, add:

```md
| 支出录入 | `/expenses/new` | 录入某天供应商支出，支持选择历史供应商或输入新供应商 |
```

- [ ] **Step 2: Add workflow section**

In `agent.md`, add:

```md
## 支出录入

路径：`/expenses/new`

支出录入页面用于登记某一天的供应商支出。页面支持选择日期、从历史发票供应商中选择供应商，也支持直接输入新的供应商名称。

主要信息：

- 日期：支出发生日期。
- 供应商：来自 `invoices.supplier_name` 的历史供应商，或用户手动输入的新供应商。
- 价格：本次支出金额。
- 备注：可选补充说明。

提交后系统会写入 `ledger_entries`，并作为 `manual` 来源的支出参与月度分析和日历概览。
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
pnpm vitest run src/tests/expense-entry.test.ts src/tests/router.smoke.test.tsx src/tests/real-data-integration.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run project smoke suite**

Run:

```bash
pnpm smoke
```

Expected: PASS.

- [ ] **Step 5: Build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add agent.md
git commit -m "docs: document expense entry workflow"
```

## Self-Review

- Spec coverage: The plan covers date, supplier, price, optional note, supplier choices from `invoices.supplier_name`, free-text supplier entry, persistence, navigation, and analytics compatibility.
- Data risk: Existing invoice-generated ledger rows have no note; migration uses a non-null default, so old rows remain valid.
- Scope control: This plan does not add delete/edit functionality. It only adds create and same-day review because the user asked for entry.
- Test coverage: Domain tests cover normalization and validation; integration tests cover D1 persistence; smoke tests cover page rendering and submit flow.

