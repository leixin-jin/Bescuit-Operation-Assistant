# Sales Total Cash Autocalc Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the sales entry page so the operator enters `TOTAL`, `BBVA`, and `CAIXA`, while `EFECTIVO` is calculated automatically as `TOTAL - BBVA - CAIXA`.

**Architecture:** Keep the database and server persistence shape unchanged: submitted records still store `totalAmount`, `bbvaAmount`, `caixaAmount`, and `cashAmount`. Add a small shared domain helper that derives the stored payment-channel payload from the new total-first UI model, then use that helper in the route and tests. The page renders `TOTAL` first, keeps `EFECTIVO` read-only, and blocks save/submit when the derived cash value is negative.

**Tech Stack:** React 19, TanStack Router, TanStack Form, TanStack Query, Vitest, Testing Library, TypeScript.

---

## File Structure

- Modify `src/lib/server/app-domain.ts`
  - Add `SalesTotalEntryInput`.
  - Add `deriveSalesChannelAmounts(input)` to convert `{ total, bbva, caixa }` into the existing `{ bbva, caixa, efectivo }` payload.
  - Add `getDerivedCashAmount(input)` so UI and tests use the same rounding logic.
- Modify `src/routes/sales/new.tsx`
  - Replace editable `EFECTIVO` field with editable `TOTAL`.
  - Render input order as `TOTAL`, `BBVA`, `CAIXA`, then read-only `EFECTIVO`.
  - Submit existing `SalesDailyDraftInput` shape with calculated `efectivo`.
  - Disable draft/submit when `TOTAL` is blank or `EFECTIVO` would be negative.
- Modify `src/tests/router.smoke.test.tsx`
  - Update the sales-entry smoke test to verify `EFECTIVO` is derived from total and card channels.
- Create `src/tests/sales-total-entry.test.ts`
  - Unit-test the shared derivation helper, including rounding and negative cash detection.
- Modify `doc/04_营业额登记与可视化.md`
  - Mark the chosen V1 sales-entry mode as total-first entry.

---

### Task 1: Add Failing Unit Tests For Total-First Derivation

**Files:**
- Create: `src/tests/sales-total-entry.test.ts`
- Modify: none
- Test: `src/tests/sales-total-entry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/tests/sales-total-entry.test.ts` with this content:

```ts
import { describe, expect, test } from 'vitest'

import {
  deriveSalesChannelAmounts,
  getDerivedCashAmount,
} from '@/lib/server/app-domain'

describe('sales total-first entry helpers', () => {
  test('derives efectivo from total minus BBVA and CAIXA', () => {
    expect(
      deriveSalesChannelAmounts({
        total: '100',
        bbva: '35.50',
        caixa: '20',
      }),
    ).toEqual({
      bbva: '35.50',
      caixa: '20.00',
      efectivo: '44.50',
    })
  })

  test('rounds derived efectivo to cents', () => {
    expect(
      deriveSalesChannelAmounts({
        total: '10.005',
        bbva: '1.002',
        caixa: '2.003',
      }),
    ).toEqual({
      bbva: '1.00',
      caixa: '2.00',
      efectivo: '7.01',
    })
  })

  test('exposes negative efectivo so the UI can block impossible totals', () => {
    expect(
      getDerivedCashAmount({
        total: '50',
        bbva: '40',
        caixa: '20',
      }),
    ).toBe(-10)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run src/tests/sales-total-entry.test.ts
```

Expected: FAIL because `deriveSalesChannelAmounts` and `getDerivedCashAmount` are not exported from `src/lib/server/app-domain.ts`.

- [ ] **Step 3: Commit the failing test**

```bash
git add src/tests/sales-total-entry.test.ts
git commit -m "test: cover total-first sales entry derivation"
```

---

### Task 2: Implement Shared Derivation Helpers

**Files:**
- Modify: `src/lib/server/app-domain.ts`
- Test: `src/tests/sales-total-entry.test.ts`

- [ ] **Step 1: Add the input interface**

In `src/lib/server/app-domain.ts`, immediately after `SalesDailyDraftInput`, add:

```ts
export interface SalesTotalEntryInput {
  total: string
  bbva: string
  caixa: string
}
```

- [ ] **Step 2: Add derivation helpers**

In `src/lib/server/app-domain.ts`, immediately after `normalizeSalesDraftInput`, add:

```ts
export function deriveSalesChannelAmounts(
  input: SalesTotalEntryInput,
): Record<PaymentChannelId, string> {
  const bbvaAmount = parseCurrencyAmount(input.bbva)
  const caixaAmount = parseCurrencyAmount(input.caixa)
  const cashAmount = getDerivedCashAmount(input)

  return {
    bbva: formatSalesPayloadAmount(bbvaAmount),
    caixa: formatSalesPayloadAmount(caixaAmount),
    efectivo: formatSalesPayloadAmount(cashAmount),
  }
}

export function getDerivedCashAmount(input: SalesTotalEntryInput) {
  const totalAmount = parseCurrencyAmount(input.total)
  const bbvaAmount = parseCurrencyAmount(input.bbva)
  const caixaAmount = parseCurrencyAmount(input.caixa)

  return roundCurrency(totalAmount - bbvaAmount - caixaAmount)
}
```

Near the existing private `normalizeDecimalString` helper, add:

```ts
function formatSalesPayloadAmount(value: number) {
  return roundCurrency(value).toFixed(2)
}
```

- [ ] **Step 3: Run the unit test**

Run:

```bash
pnpm vitest run src/tests/sales-total-entry.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit the helper**

```bash
git add src/lib/server/app-domain.ts src/tests/sales-total-entry.test.ts
git commit -m "feat: derive sales cash from total entry"
```

---

### Task 3: Update Sales Entry Page UI And Payload

**Files:**
- Modify: `src/routes/sales/new.tsx`
- Test: `src/tests/router.smoke.test.tsx`

- [ ] **Step 1: Update imports**

In `src/routes/sales/new.tsx`, change the `lucide-react` import to include `AlertTriangle`:

```ts
import {
  AlertTriangle,
  ArrowLeft,
  CalendarIcon,
  CheckCircle,
  Euro,
  Save,
} from 'lucide-react'
```

In the `@/lib/server/app-domain` import, add the helper exports and remove the unused `type SalesDailyDraftInput` only if TypeScript reports it unused after the payload change:

```ts
import {
  deriveSalesChannelAmounts,
  getDerivedCashAmount,
  getMadridTodayInputValue,
  paymentChannels,
  type SalesDailyDraftInput,
  type SalesDailyRecord,
} from '@/lib/server/app-domain'
```

- [ ] **Step 2: Define the editable input rows**

In `src/routes/sales/new.tsx`, immediately after `type SalesPersistMode = 'draft' | 'submit'`, add:

```ts
const salesEntryInputs = [
  { id: 'total', name: 'TOTAL', color: 'bg-neutral-900' },
  { id: 'bbva', name: 'BBVA', color: 'bg-blue-500' },
  { id: 'caixa', name: 'CAIXA', color: 'bg-red-500' },
] satisfies Array<{
  id: keyof Pick<SalesFormValues, 'total' | 'bbva' | 'caixa'>
  name: string
  color: string
}>
```

- [ ] **Step 3: Change form values from editable efectivo to editable total**

Replace the `SalesFormValues` interface with:

```ts
interface SalesFormValues {
  businessDate: string
  total: string
  bbva: string
  caixa: string
  notes: string
}
```

Replace `createAmountInputs` with:

```ts
function createAmountInputs(record: SalesDailyRecord | null) {
  if (!record) {
    return {
      total: '',
      bbva: '',
      caixa: '',
    }
  }

  return {
    total: formatAmountInput(record.totalAmount),
    bbva: formatAmountInput(record.bbvaAmount),
    caixa: formatAmountInput(record.caixaAmount),
  }
}
```

Replace `createSalesFormValues` with:

```ts
function createSalesFormValues(
  record: SalesDailyRecord | null,
  businessDate: string,
): SalesFormValues {
  const amounts = createAmountInputs(record)

  return {
    businessDate,
    total: amounts.total,
    bbva: amounts.bbva,
    caixa: amounts.caixa,
    notes: record?.note ?? '',
  }
}
```

- [ ] **Step 4: Replace total and payload helpers**

Replace `getSalesTotal` with:

```ts
function getSalesTotal(values: SalesFormValues) {
  return Number.parseFloat(values.total) || 0
}
```

Replace `toSalesPayload` with:

```ts
function toSalesPayload(values: SalesFormValues): SalesDailyDraftInput {
  return {
    date: values.businessDate,
    amounts: deriveSalesChannelAmounts(values),
    notes: values.notes,
  }
}
```

Add these helpers below `toSalesPayload`:

```ts
function isSalesFormSubmittable(values: SalesFormValues) {
  return values.total.trim() !== '' && getDerivedCashAmount(values) >= 0
}

function formatCalculatedAmount(value: number) {
  return value.toFixed(2)
}
```

- [ ] **Step 5: Guard submit and draft save**

In the `useForm` config, replace the `onSubmit` body with:

```ts
onSubmit: async ({ value, meta }) => {
  if (!isSalesFormSubmittable(value)) {
    setFeedbackMessage('TOTAL 不能为空，且不能小于 BBVA 和 CAIXA 的合计。')
    return
  }

  await saveSalesMutation.mutateAsync({ mode: meta.mode, value })
},
```

- [ ] **Step 6: Render TOTAL, BBVA, CAIXA as editable inputs**

In the payment-channel card, replace:

```tsx
{loaderData.paymentChannels.map((channel) => (
```

with:

```tsx
{salesEntryInputs.map((channel) => (
```

Keep the existing `form.Field` input markup inside that loop. It will now bind to `total`, `bbva`, and `caixa`.

- [ ] **Step 7: Render read-only EFECTIVO**

Immediately after the editable input loop and before the existing total summary block, add:

```tsx
<form.Subscribe
  selector={(state) => {
    const cashAmount = getDerivedCashAmount(state.values)

    return {
      cashAmount,
      isNegativeCash: cashAmount < 0,
    }
  }}
  children={({ cashAmount, isNegativeCash }) => (
    <div className="space-y-2">
      <Label htmlFor="efectivo" className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
        EFECTIVO
      </Label>
      <div className="relative">
        <Euro className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="efectivo"
          readOnly
          value={formatCalculatedAmount(cashAmount)}
          className={`rounded-lg pl-10 text-right text-lg font-medium ${
            isNegativeCash ? 'border-destructive text-destructive' : ''
          }`}
        />
      </div>
      {isNegativeCash ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          TOTAL 不能小于 BBVA 和 CAIXA 的合计。
        </div>
      ) : null}
    </div>
  )}
/>
```

- [ ] **Step 8: Disable buttons when the form cannot be saved**

Replace the existing final button block, the one that currently renders the `保存草稿` and `确认提交` buttons, with:

```tsx
<form.Subscribe
  selector={(state) => isSalesFormSubmittable(state.values)}
  children={(canSubmitSales) => (
    <div className="flex gap-3">
      <Button
        type="button"
        variant="secondary"
        className="flex-1 rounded-lg"
        disabled={saveSalesMutation.isPending || !canSubmitSales}
        onClick={() => void form.handleSubmit({ mode: 'draft' })}
      >
        <Save className="mr-2 h-4 w-4" />
        保存草稿
      </Button>
      <Button
        type="submit"
        className="flex-1 rounded-lg"
        disabled={saveSalesMutation.isPending || !canSubmitSales}
      >
        <CheckCircle className="mr-2 h-4 w-4" />
        确认提交
      </Button>
    </div>
  )}
/>
```

- [ ] **Step 9: Run typecheck through build**

Run:

```bash
pnpm run build
```

Expected: PASS.

- [ ] **Step 10: Commit the UI change**

```bash
git add src/routes/sales/new.tsx src/lib/server/app-domain.ts
git commit -m "feat: make sales entry total-first"
```

---

### Task 4: Update Sales Entry Smoke Test

**Files:**
- Modify: `src/tests/router.smoke.test.tsx`
- Test: `src/tests/router.smoke.test.tsx`

- [ ] **Step 1: Replace the existing sales-entry smoke test**

In `src/tests/router.smoke.test.tsx`, replace:

```ts
test('sales entry page recomputes the total when channel amounts change', async () => {
  await renderRoute('/sales/new')

  fireEvent.change(screen.getByLabelText('BBVA'), {
    target: { value: '10.50' },
  })
  fireEvent.change(screen.getByLabelText('CAIXA'), {
    target: { value: '20' },
  })

  expect(screen.getByText('€30.50')).toBeTruthy()
})
```

with:

```ts
test('sales entry page derives efectivo from total minus card channels', async () => {
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

  expect(screen.getByText('€100.00')).toBeTruthy()
  expect((screen.getByLabelText('EFECTIVO') as HTMLInputElement).value).toBe(
    '44.50',
  )
})
```

- [ ] **Step 2: Run the smoke test**

Run:

```bash
pnpm vitest run src/tests/router.smoke.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run the focused sales tests**

Run:

```bash
pnpm vitest run src/tests/sales-total-entry.test.ts src/tests/sales-boundary.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit the smoke-test update**

```bash
git add src/tests/router.smoke.test.tsx src/tests/sales-total-entry.test.ts
git commit -m "test: verify total-first sales entry UI"
```

---

### Task 5: Update Sales Documentation

**Files:**
- Modify: `doc/04_营业额登记与可视化.md`
- Test: none

- [ ] **Step 1: Replace the two-option sales-entry wording**

In `doc/04_营业额登记与可视化.md`, replace this paragraph under `### 营业额录入逻辑`:

```md
推荐两种录入方式：

1. 直接录入三个渠道金额
2. 录入 `总营业额 + 已知渠道金额`，系统自动反推 `EFECTIVO`
```

with:

```md
V1 采用总额优先录入方式：

1. 用户录入 `TOTAL`
2. 用户录入 `BBVA`
3. 用户录入 `CAIXA`
4. 系统自动计算 `EFECTIVO = TOTAL - BBVA - CAIXA`

当 `TOTAL` 小于 `BBVA + CAIXA` 时，页面不允许保存草稿或提交正式营业额，因为这会产生负数现金。
```

- [ ] **Step 2: Commit the documentation update**

```bash
git add doc/04_营业额登记与可视化.md
git commit -m "docs: document total-first sales entry"
```

---

### Task 6: Final Verification

**Files:**
- Modify: none
- Test: all touched behavior

- [ ] **Step 1: Run the full test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 2: Run the production build**

Run:

```bash
pnpm run build
```

Expected: PASS.

- [ ] **Step 3: Start the local app**

Run:

```bash
pnpm run dev
```

Expected: Vite starts on `http://localhost:3000`.

- [ ] **Step 4: Manually verify `/sales/new`**

Open `http://localhost:3000/sales/new` and verify:

- The fields render in this order: `TOTAL`, `BBVA`, `CAIXA`, `EFECTIVO`.
- `EFECTIVO` is read-only.
- Entering `TOTAL = 100`, `BBVA = 35.50`, `CAIXA = 20` shows `EFECTIVO = 44.50`.
- The summary shows `€100.00`.
- Setting `TOTAL = 50`, `BBVA = 40`, `CAIXA = 20` shows a negative-cash warning and disables both save buttons.

- [ ] **Step 5: Final commit if verification required fixes**

If verification required code or test fixes, commit the files owned by this plan:

```bash
git status --short
git add src/lib/server/app-domain.ts src/routes/sales/new.tsx src/tests/router.smoke.test.tsx src/tests/sales-total-entry.test.ts doc/04_营业额登记与可视化.md
git commit -m "fix: stabilize total-first sales entry"
```

---

## Self-Review

- Spec coverage: The plan implements the requested `TOTAL`, `BBVA`, `CAIXA` inputs and automatic `EFECTIVO` calculation on the sales entry page.
- Data model: No migration is needed because `sales_daily` already has `total_amount`, `bbva_amount`, `caixa_amount`, and `cash_amount`.
- Test coverage: Unit tests cover derivation logic; smoke tests cover the actual page behavior; existing sales boundary tests continue to verify persistence and analytics.
- Type consistency: The new UI model is named `SalesFormValues`; the persisted model remains `SalesDailyDraftInput`; channel IDs remain the existing `PaymentChannelId` values.
