# Valid Price Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Show whether each invoice review line item changed price versus its previous valid purchase, while letting users exclude abnormal prices from future tracking.

**Architecture:** Store a `valid_price` flag on `invoice_items`, defaulting to valid for all old and new data. Extend invoice review drafts so the flag survives extraction, editing, saving, and reload. Add a focused server query that compares a current line item against the previous `valid_price = 1` item using `invoices.invoice_date` as the business timeline.

**Tech Stack:** Cloudflare D1 / SQLite migrations, Drizzle schema, TanStack React Start server functions, React review UI, Vitest.

---

## File Structure

- Modify `migrations/0004_invoice_item_valid_price.sql`: add `invoice_items.valid_price` with default valid.
- Modify `src/lib/db/schema.ts`: add `validPrice` to the Drizzle `invoiceItems` schema.
- Modify `src/lib/server/app-domain.ts`: add `excludeFromPriceTracking?: boolean` and price comparison types to invoice line item domain models.
- Modify `src/lib/server/extraction.ts`: default extracted and rehydrated line items to valid prices unless explicitly excluded.
- Modify `src/lib/server/mutations/invoices.rpc.ts`: persist `valid_price` when saving/confirming invoice review jobs.
- Modify `src/lib/server/queries/invoices.rpc.ts`: return invoice review page data plus price comparison state for each line item.
- Create `src/lib/server/queries/price-comparison.ts`: isolate previous-valid-price lookup and comparison formatting.
- Modify `src/routes/invoices/review/$jobId.tsx`: add a per-line “不计入价格追踪” checkbox and display comparison status.
- Modify `src/tests/real-data-integration.test.ts`: cover persistence, reload, and comparison filtering.
- Modify `src/tests/invoice-review-rehydration.test.tsx`: cover UI state rehydration for excluded price tracking.

---

### Task 1: Add Database Field

**Files:**
- Create: `migrations/0004_invoice_item_valid_price.sql`
- Modify: `src/lib/db/schema.ts`
- Test: `src/tests/invoice-pipeline-readiness.test.ts`

- [x] **Step 1: Write the migration**

```sql
ALTER TABLE invoice_items
ADD COLUMN valid_price integer NOT NULL DEFAULT 1;
```

- [x] **Step 2: Update Drizzle schema**

Add this field inside `invoiceItems` in `src/lib/db/schema.ts`:

```ts
validPrice: integer('valid_price').notNull().default(1),
```

Also update the import:

```ts
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
```

- [x] **Step 3: Update pipeline readiness expectations**

In `src/tests/invoice-pipeline-readiness.test.ts`, extend the expected `invoice_items` column list to include:

```ts
'valid_price'
```

- [x] **Step 4: Run readiness test**

Run:

```bash
pnpm vitest run src/tests/invoice-pipeline-readiness.test.ts
```

Expected: the test passes after the schema and readiness checks agree.

---

### Task 2: Add Domain Field And Defaults

**Files:**
- Modify: `src/lib/server/app-domain.ts`
- Modify: `src/lib/server/extraction.ts`
- Test: `src/tests/invoice-extraction.test.ts`

- [x] **Step 1: Add UI-facing flag**

Add to `InvoiceLineItemDraft`:

```ts
excludeFromPriceTracking?: boolean
```

The field is optional so older serialized extraction payloads remain valid.

- [x] **Step 2: Default extracted line items to valid prices**

Where `InvoiceLineItemDraft` objects are created in `src/lib/server/extraction.ts`, set:

```ts
excludeFromPriceTracking: false,
```

When parsing stored line items, coerce missing values to `false`:

```ts
excludeFromPriceTracking: value.excludeFromPriceTracking === true,
```

- [x] **Step 3: Add extraction test coverage**

In `src/tests/invoice-extraction.test.ts`, add assertions to existing parsed line item tests:

```ts
expect(result.lineItems[0]?.excludeFromPriceTracking).toBe(false)
```

Add one test that parses a stored draft with:

```ts
excludeFromPriceTracking: true
```

Expected assertion:

```ts
expect(result.lineItems[0]?.excludeFromPriceTracking).toBe(true)
```

- [x] **Step 4: Run extraction tests**

Run:

```bash
pnpm vitest run src/tests/invoice-extraction.test.ts
```

Expected: tests pass and old payloads without the field still parse.

---

### Task 3: Persist Valid Price On Save

**Files:**
- Modify: `src/lib/server/mutations/invoices.rpc.ts`
- Test: `src/tests/real-data-integration.test.ts`

- [x] **Step 1: Write failing persistence test**

Add a real-data integration test that saves an invoice with two line items:

```ts
lineItems: [
  {
    id: 'item-1',
    name: 'Coca Cola 330ml',
    qty: '24',
    unit: 'can',
    unitPrice: '0.85',
    lineTotal: '20.40',
    ingredient: '',
    matched: false,
    excludeFromPriceTracking: false,
  },
  {
    id: 'item-2',
    name: 'Coca Cola 330ml Promo',
    qty: '24',
    unit: 'can',
    unitPrice: '1.10',
    lineTotal: '26.40',
    ingredient: '',
    matched: false,
    excludeFromPriceTracking: true,
  },
]
```

Expected stored rows:

```ts
expect(tables.invoice_items[0]?.valid_price).toBe(1)
expect(tables.invoice_items[1]?.valid_price).toBe(0)
```

- [x] **Step 2: Add insert column and binding**

In `src/lib/server/mutations/invoices.rpc.ts`, add `valid_price` to the `INSERT INTO invoice_items` column list and add one placeholder.

Bind:

```ts
item.excludeFromPriceTracking ? 0 : 1,
```

- [x] **Step 3: Update fake D1 test harness**

In `src/tests/real-data-integration.test.ts`, update the in-memory `InvoiceItemRow` type and insert handler to store:

```ts
valid_price: Number(validPrice),
```

- [x] **Step 4: Run integration test**

Run:

```bash
pnpm vitest run src/tests/real-data-integration.test.ts
```

Expected: the new persistence test passes.

---

### Task 4: Build Previous Valid Price Query

**Files:**
- Create: `src/lib/server/queries/price-comparison.ts`
- Modify: `src/lib/server/app-domain.ts`
- Test: `src/tests/real-data-integration.test.ts`

- [x] **Step 1: Add comparison domain type**

Add to `src/lib/server/app-domain.ts`:

```ts
export type InvoiceItemPriceDirection = 'up' | 'down' | 'same'

export interface InvoiceItemPriceComparison {
  status: 'excluded' | 'first_record' | 'changed' | 'unchanged'
  previousPrice?: number
  previousInvoiceDate?: string
  previousSupplierName?: string
  delta?: number
  deltaPercent?: number
  direction?: InvoiceItemPriceDirection
}
```

Add to `InvoiceLineItemDraft`:

```ts
priceComparison?: InvoiceItemPriceComparison
```

- [x] **Step 2: Implement query helper**

Create `src/lib/server/queries/price-comparison.ts` with a helper that accepts current item identity and invoice date, then finds the previous valid row:

```sql
SELECT
  ii.raw_unit_price AS previousPrice,
  i.invoice_date AS previousInvoiceDate,
  i.supplier_name AS previousSupplierName
FROM invoice_items ii
INNER JOIN invoices i ON i.id = ii.invoice_id
WHERE ii.valid_price = 1
  AND ii.raw_unit_price IS NOT NULL
  AND i.invoice_date < ?
  AND (
    (? IS NOT NULL AND ii.ingredient_id = ?)
    OR (? IS NULL AND ii.raw_product_name = ?)
  )
ORDER BY i.invoice_date DESC, i.created_at DESC
LIMIT 1
```

Comparison rules:

```ts
if (excludeFromPriceTracking) return { status: 'excluded' }
if (!previousRow) return { status: 'first_record' }
if (previousPrice === currentPrice) return { status: 'unchanged', previousPrice, previousInvoiceDate, previousSupplierName, delta: 0, deltaPercent: 0, direction: 'same' }
return { status: 'changed', previousPrice, previousInvoiceDate, previousSupplierName, delta, deltaPercent, direction }
```

- [x] **Step 3: Add comparison tests**

Add tests covering:

- current valid item changed from previous valid item
- current valid item ignores previous `valid_price = 0`
- current excluded item returns `status: 'excluded'`
- no previous valid item returns `status: 'first_record'`

- [x] **Step 4: Run comparison tests**

Run:

```bash
pnpm vitest run src/tests/real-data-integration.test.ts
```

Expected: all four comparison cases pass.

---

### Task 5: Return Comparison Data On Review Page

**Files:**
- Modify: `src/lib/server/queries/invoices.rpc.ts`
- Test: `src/tests/real-data-integration.test.ts`

- [x] **Step 1: Load comparisons after building review job**

In `getInvoiceReviewPageDataServerFn`, after loading `job`, call the price comparison helper when `job` exists.

For each `job.lineItems[index]`, attach:

```ts
priceComparison: comparisonByLineItemId.get(item.id)
```

If the current invoice has not been persisted yet, compare by draft fields against historical persisted invoice items using the draft invoice date.

- [x] **Step 2: Preserve null-safe behavior**

If `env.DB` is unavailable or `job` is null, return the current shape:

```ts
return {
  job,
  ingredientOptions: await listIngredientOptions(env),
}
```

with no comparison data.

- [x] **Step 3: Test review page data shape**

In `src/tests/real-data-integration.test.ts`, assert that review page data includes:

```ts
expect(data.job?.lineItems[0]?.priceComparison?.status).toBe('changed')
```

- [x] **Step 4: Run review data tests**

Run:

```bash
pnpm vitest run src/tests/real-data-integration.test.ts
```

Expected: review page data includes price comparison without breaking existing ingredient options.

---

### Task 6: Add Invoice Review UI

**Files:**
- Modify: `src/routes/invoices/review/$jobId.tsx`
- Test: `src/tests/invoice-review-rehydration.test.tsx`

- [x] **Step 1: Write UI test**

Add a rehydration test that renders a line item with:

```ts
excludeFromPriceTracking: true,
priceComparison: { status: 'excluded' },
```

Expected UI:

```ts
expect(screen.getByLabelText('不计入价格追踪')).toBeChecked()
expect(screen.getByText('已排除价格追踪')).toBeInTheDocument()
```

- [x] **Step 2: Add checkbox column/control**

In the invoice review item table, add a checkbox labeled:

```text
不计入价格追踪
```

When checked, update the line item:

```ts
excludeFromPriceTracking: checked === true
```

- [x] **Step 3: Render comparison badge text**

Render status text:

```ts
excluded -> 已排除价格追踪
first_record -> 首次记录
unchanged -> 价格无变化
changed + up -> 较上次上涨 €{delta} ({deltaPercent}%)
changed + down -> 较上次下降 €{Math.abs(delta)} ({Math.abs(deltaPercent)}%)
```

Include previous date when present:

```text
vs 2026-04-12
```

- [x] **Step 4: Run UI test**

Run:

```bash
pnpm vitest run src/tests/invoice-review-rehydration.test.tsx
```

Expected: checkbox state and comparison badge render correctly.

---

### Task 7: Final Verification

**Files:**
- No new files.

- [x] **Step 1: Run focused test suite**

Run:

```bash
pnpm vitest run src/tests/invoice-extraction.test.ts src/tests/invoice-review-rehydration.test.tsx src/tests/invoice-pipeline-readiness.test.ts src/tests/real-data-integration.test.ts
```

Expected: all focused tests pass.

- [x] **Step 2: Run build**

Run:

```bash
pnpm run build
```

Expected: production build passes.

- [x] **Step 3: Manual browser check**

Run:

```bash
pnpm run dev
```

Open `http://localhost:3000/invoices/new`, then navigate to an invoice review page. Verify:

- The checkbox defaults unchecked.
- Checking it marks the item as excluded.
- Saving and reloading preserves the checkbox.
- Valid items show previous price comparison.
- Excluded items show “已排除价格追踪”.

---

## Self-Review

- Spec coverage: the plan covers database storage, default valid behavior, invoice review UI, save/reload, and previous valid price comparison.
- Placeholder scan: no `TBD`, `TODO`, or unspecified “handle later” steps remain.
- Type consistency: the plan consistently uses `excludeFromPriceTracking` in UI/domain code and `valid_price` in database code.
