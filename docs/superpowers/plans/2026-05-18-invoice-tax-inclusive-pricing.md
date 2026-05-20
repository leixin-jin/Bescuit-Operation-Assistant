# Invoice Tax Inclusive Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make invoice extraction and review show tax-included `precio_unitario`, `precio_total`, and `IVA` per line item, while removing ingredient mapping from the invoice review workflow.

**Architecture:** Keep the existing PDF/image upload and Gemini extraction pipeline, but make line-item pricing tax-inclusive at the normalization boundary before data reaches the review UI. The app will still persist the existing invoice draft JSON, but review readiness will no longer depend on `ingredient`/`matched`; mapping fields remain only as backward-compatible storage fields until a later database cleanup.

**Tech Stack:** React 19, TanStack Router, TanStack React Form, TanStack Table, TanStack React Start server functions, Cloudflare D1/R2, Gemini structured output, Zod, Vitest, Testing Library.

---

## File Structure

- Modify: `src/lib/server/app-domain.ts`
  - Add optional invoice party metadata fields for supplier/customer CIF and address.
  - Add optional `notes` on each line item for discount text such as `Descuento: 42,33`.
  - Stop using unmatched ingredient count as a readiness blocker.
- Modify: `src/lib/server/invoice-extraction/schema.ts`
  - Update provider schema and Zod schema to capture supplier/customer metadata, `taxRate`, and line-item `notes`.
  - Normalize line items so `unitPrice` and `lineTotal` are canonical tax-included prices.
  - Preserve old provider responses by converting net line totals with `taxRate` when needed.
- Modify: `src/lib/server/invoice-extraction/gemini-provider.ts`
  - Change the extraction prompt to ask explicitly for tax-included line totals and tax-included unit prices.
  - Tell Gemini to put discount/extra text in `lineItems[].notes`.
  - Keep the existing instruction that ingredient mapping must not be inferred.
- Modify: `src/lib/server/extraction.ts`
  - Rehydrate optional `taxRate` and `notes`.
  - Make pending/manual fallback drafts compatible with the no-mapping workflow.
- Modify: `src/features/invoices/review-header-form.tsx`
  - Display optional supplier/customer CIF and address when extracted.
- Modify: `src/features/invoices/review-table.tsx`
  - Remove status dot and ingredient mapping column.
  - Show columns: product, quantity, tax-included unit price, tax-included total price, IVA, notes.
- Modify: `src/routes/invoices/review/$jobId.tsx`
  - Remove ingredient change handling and mapping-specific validation messages.
  - Keep save/confirm behavior, but do not block confirm because a line has no ingredient.
- Modify: `src/lib/server/mutations/invoices.rpc.ts`
  - Persist confirmed invoice items with `ingredient_id = null`; do not mark this as a blocking failure.
  - Prefer the stored `lineTotal` over `qty * unitPrice` because unit rounding can differ by 0.01.
- Modify: `src/tests/invoice-extraction.test.ts`
  - Add a fixture for `Factura venta FP26020968.pdf`-style data proving tax-inclusive normalization.
- Modify: `src/tests/invoice-review-rehydration.test.tsx`
  - Assert the review table shows IVA and no ingredient mapping column.
- Modify: `src/tests/real-data-integration.test.ts`
  - Assert confirm works with unmapped line items and writes invoice item totals from stored tax-included totals.

---

### Task 1: Lock the Domain Contract

**Files:**
- Modify: `src/lib/server/app-domain.ts`
- Test: `src/tests/invoice-extraction.test.ts`

- [ ] **Step 1: Add the expected domain shape test**

Add this test inside `describe('invoice extraction helpers', () => { ... })` in `src/tests/invoice-extraction.test.ts`:

```ts
  test('normalizes FP26020968 line items to tax-included unit and total prices', () => {
    const draft = parseProviderExtractionResponse({
      rawJson: JSON.stringify({
        schemaVersion: 'invoice-extraction-v2',
        pageCount: 1,
        documentKind: 'pdf',
        header: {
          supplier: 'VINOS ISABEL MARIA CRUSAT SA',
          supplierTaxId: 'A58000985',
          supplierAddress: 'Carrer Miquel Servet 10-12, 08850 Gava (Barcelona)',
          customerName: 'BESCUIT BAR',
          customerTaxId: 'X7994517Q',
          customerAddress: 'ROGER DE FLOR 77-79, 08013 Barcelona',
          invoiceNo: 'FP26020968',
          date: '2026-04-21',
          subtotalAmount: '88.16',
          taxAmount: '18.51',
          totalAmount: '106.67',
          currency: 'EUR',
          notes: 'Forma de pago: CONT Contado/Metalico/Factura',
        },
        lineItems: [
          {
            id: '1',
            name: 'SERV. ENTREGA/RECOGIDA',
            qty: '1.00',
            unit: 'un',
            unitPrice: '3.49',
            lineTotal: '3.49',
            taxRate: '21%',
            ingredient: '',
            matched: false,
          },
          {
            id: '802',
            name: 'ESTRELLA GALICIA 24x33 cl. RET',
            qty: '4.00',
            unit: 'un',
            unitPrice: '31.75',
            lineTotal: '84.67',
            taxRate: '21%',
            notes: 'Descuento: 42,33',
            ingredient: '',
            matched: false,
          },
        ],
        confidence: {
          overall: 0.95,
          header: 0.98,
          lineItems: 0.95,
          totals: 0.95,
        },
        warnings: [],
        provider: 'gemini',
        model: 'gemini-3.1-flash-lite',
      }),
      fileName: 'Factura venta FP26020968.pdf',
      provider: 'gemini',
      model: 'gemini-3.1-flash-lite',
      documentKind: 'pdf',
    })

    expect(draft.header).toMatchObject({
      supplier: 'VINOS ISABEL MARIA CRUSAT SA',
      supplierTaxId: 'A58000985',
      customerName: 'BESCUIT BAR',
      customerTaxId: 'X7994517Q',
      invoiceNo: 'FP26020968',
      date: '2026-04-21',
      totalAmount: '106.67',
      taxAmount: '18.51',
    })
    expect(draft.lineItems).toEqual([
      expect.objectContaining({
        id: '1',
        name: 'SERV. ENTREGA/RECOGIDA',
        qty: '1.00',
        unitPrice: '4.22',
        lineTotal: '4.22',
        taxRate: '21%',
        ingredient: '',
        matched: false,
      }),
      expect.objectContaining({
        id: '802',
        name: 'ESTRELLA GALICIA 24x33 cl. RET',
        qty: '4.00',
        unitPrice: '25.61',
        lineTotal: '102.45',
        taxRate: '21%',
        notes: 'Descuento: 42,33',
        ingredient: '',
        matched: false,
      }),
    ])
  })
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm vitest run src/tests/invoice-extraction.test.ts
```

Expected: FAIL because header party fields and line-item `notes` are not in the schema/type yet, and prices are still treated as net values.

- [ ] **Step 3: Extend invoice draft types**

In `src/lib/server/app-domain.ts`, update `InvoiceHeaderDraft`:

```ts
export interface InvoiceHeaderDraft {
  supplier: string
  supplierTaxId?: string
  supplierAddress?: string
  customerName?: string
  customerTaxId?: string
  customerAddress?: string
  invoiceNo: string
  date: string
  totalAmount: string
  taxAmount: string
  notes: string
}
```

Update `InvoiceLineItemDraft`:

```ts
export interface InvoiceLineItemDraft {
  id: string
  name: string
  qty: string
  unit: string
  unitPrice: string
  lineTotal?: string
  taxRate?: string
  notes?: string
  ingredient: string
  matched: boolean
  confidence?: number
  sourceText?: string
}
```

- [ ] **Step 4: Remove mapping from readiness**

In `src/lib/server/app-domain.ts`, change `getInvoiceReadinessSummary` so `unmatchedLineItems` is informational only:

```ts
export function getInvoiceReadinessSummary(
  job: Pick<InvoiceReviewJob, 'header' | 'lineItems'>,
): InvoiceReadinessSummary {
  const missingHeaderFields = getMissingRequiredHeaderFields(job.header)
  const invalidHeaderFields = getInvalidHeaderFields(job.header)

  return {
    isReady: missingHeaderFields.length === 0 && invalidHeaderFields.length === 0,
    missingHeaderFields,
    invalidHeaderFields,
    unmatchedLineItems: 0,
  }
}
```

- [ ] **Step 5: Run the extraction test again**

Run:

```bash
pnpm vitest run src/tests/invoice-extraction.test.ts
```

Expected: still FAIL until schema normalization is implemented in Task 2.

---

### Task 2: Normalize Provider Output to Tax-Included Prices

**Files:**
- Modify: `src/lib/server/invoice-extraction/schema.ts`
- Modify: `src/lib/server/extraction.ts`
- Test: `src/tests/invoice-extraction.test.ts`

- [ ] **Step 1: Extend the provider JSON schema**

In `src/lib/server/invoice-extraction/schema.ts`, add optional header fields inside `invoiceExtractionResponseJsonSchema.header.properties`:

```ts
supplierTaxId: { type: 'string' },
supplierAddress: { type: 'string' },
customerName: { type: 'string' },
customerTaxId: { type: 'string' },
customerAddress: { type: 'string' },
```

Add optional line-item field inside `lineItems.items.properties`:

```ts
notes: { type: 'string' },
```

Do not add these optional fields to the schema `required` arrays; old provider responses must remain parseable.

- [ ] **Step 2: Extend the Zod schema**

In `invoiceExtractionDraftV2Schema.header`, add:

```ts
supplierTaxId: z.string().optional(),
supplierAddress: z.string().optional(),
customerName: z.string().optional(),
customerTaxId: z.string().optional(),
customerAddress: z.string().optional(),
```

In `invoiceExtractionDraftV2Schema.lineItems` item object, add:

```ts
notes: z.string().optional(),
```

- [ ] **Step 3: Add currency helpers**

In `src/lib/server/invoice-extraction/schema.ts`, add these helpers near `parseMoney`:

```ts
function parseTaxRate(value: string | undefined) {
  if (!value?.trim()) {
    return null
  }

  const normalized = value.replace(',', '.')
  const percentage = normalized.match(/(\d+(?:\.\d+)?)/)?.[1]
  if (!percentage) {
    return null
  }

  const parsed = Number.parseFloat(percentage)
  return Number.isFinite(parsed) ? parsed / 100 : null
}

function formatMoney(value: number) {
  return (Math.round(value * 100) / 100).toFixed(2)
}

function calculateTaxIncludedLineTotal(lineTotal: string, taxRate: string | undefined) {
  const parsedLineTotal = parseMoney(lineTotal)
  const parsedTaxRate = parseTaxRate(taxRate)

  if (parsedLineTotal === null) {
    return ''
  }

  if (parsedTaxRate === null) {
    return formatMoney(parsedLineTotal)
  }

  return formatMoney(parsedLineTotal * (1 + parsedTaxRate))
}

function calculateTaxIncludedUnitPrice(input: {
  qty: string
  unitPrice: string
  lineTotal: string
  taxRate?: string
}) {
  const quantity = parseMoney(input.qty)
  const taxIncludedLineTotal = parseMoney(input.lineTotal)

  if (quantity !== null && quantity > 0 && taxIncludedLineTotal !== null) {
    return formatMoney(taxIncludedLineTotal / quantity)
  }

  const parsedUnitPrice = parseMoney(input.unitPrice)
  const parsedTaxRate = parseTaxRate(input.taxRate)
  if (parsedUnitPrice === null) {
    return ''
  }

  return formatMoney(parsedTaxRate === null ? parsedUnitPrice : parsedUnitPrice * (1 + parsedTaxRate))
}
```

- [ ] **Step 4: Canonicalize line prices in `normalizeV2Draft`**

In `normalizeV2Draft`, replace the current line item map with:

```ts
  const normalizedLineItems = draft.lineItems.map((item, index) => {
    const normalizedNetLineTotal = normalizeMoneyValue(item.lineTotal)
    const taxIncludedLineTotal = calculateTaxIncludedLineTotal(
      normalizedNetLineTotal,
      item.taxRate,
    )

    return {
      id: item.id.trim() || `${slugifyText(fileName)}-${index + 1}`,
      name: item.name.trim(),
      qty: normalizeNumberText(item.qty),
      unit: item.unit.trim(),
      unitPrice: calculateTaxIncludedUnitPrice({
        qty: item.qty,
        unitPrice: normalizeMoneyValue(item.unitPrice),
        lineTotal: taxIncludedLineTotal,
        taxRate: item.taxRate,
      }),
      lineTotal: taxIncludedLineTotal,
      taxRate: item.taxRate?.trim(),
      notes: item.notes?.trim(),
      ingredient: '',
      matched: false,
      confidence: item.confidence,
      sourceText: item.sourceText?.trim(),
    }
  })
```

This deliberately makes `unitPrice` and `lineTotal` tax-included in the app. For FP26020968, `84.67 * 1.21 = 102.45`, and `102.45 / 4 = 25.61`.

- [ ] **Step 5: Preserve optional header metadata**

In `normalizeV2Draft`, update `header`:

```ts
  const header = {
    supplier: draft.header.supplier.trim() || pendingHeader.supplier,
    supplierTaxId: draft.header.supplierTaxId?.trim(),
    supplierAddress: draft.header.supplierAddress?.trim(),
    customerName: draft.header.customerName?.trim(),
    customerTaxId: draft.header.customerTaxId?.trim(),
    customerAddress: draft.header.customerAddress?.trim(),
    invoiceNo: draft.header.invoiceNo.trim(),
    date: draft.header.date.trim() || pendingHeader.date,
    totalAmount: normalizeMoneyValue(draft.header.totalAmount),
    taxAmount: normalizeMoneyValue(draft.header.taxAmount),
    notes: draft.header.notes.trim(),
  }
```

- [ ] **Step 6: Rehydrate optional stored fields**

In `src/lib/server/extraction.ts`, update `StoredInvoiceExtractionDraft.header` through `Partial<InvoiceHeaderDraft>` already covers the new fields. Then update `normalizeHeaderDraft`:

```ts
    supplierTaxId:
      typeof value?.supplierTaxId === 'string' ? value.supplierTaxId : fallback.supplierTaxId,
    supplierAddress:
      typeof value?.supplierAddress === 'string'
        ? value.supplierAddress
        : fallback.supplierAddress,
    customerName:
      typeof value?.customerName === 'string' ? value.customerName : fallback.customerName,
    customerTaxId:
      typeof value?.customerTaxId === 'string'
        ? value.customerTaxId
        : fallback.customerTaxId,
    customerAddress:
      typeof value?.customerAddress === 'string'
        ? value.customerAddress
        : fallback.customerAddress,
```

Add `notes` to `normalizeLineItemDraft`:

```ts
    notes:
      typeof value.notes === 'string' && value.notes.trim().length > 0
        ? value.notes
        : undefined,
```

- [ ] **Step 7: Run the focused extraction tests**

Run:

```bash
pnpm vitest run src/tests/invoice-extraction.test.ts
```

Expected: PASS, including the FP26020968 normalization test.

---

### Task 3: Update Gemini Prompt for the Existing PDF Pipeline

**Files:**
- Modify: `src/lib/server/invoice-extraction/gemini-provider.ts`
- Test: `src/tests/invoice-extraction.test.ts`

- [ ] **Step 1: Assert the prompt asks for tax-included prices**

In the existing test `sends Gemini structured output fields accepted by generateContent REST API`, after `const requestBody = ...`, add:

```ts
      const promptText = requestBody.contents[0].parts
        .map((part: { text?: string }) => part.text ?? '')
        .join('\n')

      expect(promptText).toContain('tax-included')
      expect(promptText).toContain('lineItems[].notes')
      expect(promptText).toContain('ingredient must be an empty string')
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm vitest run src/tests/invoice-extraction.test.ts -t "sends Gemini"
```

Expected: FAIL because the prompt does not yet include the new tax-included wording.

- [ ] **Step 3: Update `buildInvoiceExtractionPrompt`**

Replace the `Rules:` section in `src/lib/server/invoice-extraction/gemini-provider.ts` with:

```ts
    'Rules:',
    '- Return only JSON that matches the schema.',
    '- Preserve invoice line items as product rows, not accounting summaries.',
    '- Use YYYY-MM-DD dates when visible; leave uncertain fields empty.',
    '- Use dot decimal money strings, for example 12.50.',
    '- For each line item, unitPrice and lineTotal must be tax-included prices for display.',
    '- If the PDF shows net prices plus IVA, calculate tax-included lineTotal = net line total * (1 + IVA rate).',
    '- If discounts, portes, returns, or other adjustments are printed on a product row, put the text in lineItems[].notes.',
    '- Put the visible IVA rate in lineItems[].taxRate, for example 21%.',
    '- Put missing, low-confidence, or inconsistent totals in warnings.',
    '- Do not infer ingredient mappings; ingredient must be an empty string and matched must be false.',
```

- [ ] **Step 4: Run the focused prompt test**

Run:

```bash
pnpm vitest run src/tests/invoice-extraction.test.ts -t "sends Gemini"
```

Expected: PASS.

---

### Task 4: Remove Mapping from the Review UI

**Files:**
- Modify: `src/features/invoices/review-table.tsx`
- Modify: `src/routes/invoices/review/$jobId.tsx`
- Test: `src/tests/invoice-review-rehydration.test.tsx`

- [ ] **Step 1: Add UI regression tests**

In `src/tests/invoice-review-rehydration.test.tsx`, add a test that renders a review job with `taxRate: '21%'`, `lineTotal: '102.45'`, `unitPrice: '25.61'`, and `notes: 'Descuento: 42,33'`.

Use these assertions:

```ts
    expect(screen.getByText('IVA')).toBeInTheDocument()
    expect(screen.getByText('21%')).toBeInTheDocument()
    expect(screen.getByDisplayValue('25.61')).toBeInTheDocument()
    expect(screen.getByText('€102.45')).toBeInTheDocument()
    expect(screen.getByText('Descuento: 42,33')).toBeInTheDocument()
    expect(screen.queryByText('原料映射')).not.toBeInTheDocument()
    expect(screen.queryByText(/未映射到原料库/)).not.toBeInTheDocument()
```

- [ ] **Step 2: Run the UI test and verify it fails**

Run:

```bash
pnpm vitest run src/tests/invoice-review-rehydration.test.tsx
```

Expected: FAIL because the table still renders `原料映射` and does not show `IVA`/notes.

- [ ] **Step 3: Change `ReviewTableProps`**

In `src/features/invoices/review-table.tsx`, remove `ingredientOptions` and `onIngredientChange` from props:

```ts
interface ReviewTableProps {
  lineItems: InvoiceLineItemDraft[]
  disabled?: boolean
  onQuantityChange: (itemId: string, value: string) => void
  onUnitPriceChange: (itemId: string, value: string) => void
}
```

Remove imports for `AlertCircle`, `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue`, and `IngredientOption`.

- [ ] **Step 4: Replace status/mapping columns with IVA and notes**

In the columns array, delete the `status` column and the `ingredient` column. Add:

```tsx
      columnHelper.display({
        id: 'taxRate',
        header: () => <span className="block text-right">IVA</span>,
        cell: ({ row }) => (
          <span className="block text-right text-sm">
            {row.original.taxRate?.trim() || '-'}
          </span>
        ),
      }),
      columnHelper.display({
        id: 'notes',
        header: '其他',
        cell: ({ row }) =>
          row.original.notes ? (
            <span className="text-sm text-muted-foreground">{row.original.notes}</span>
          ) : (
            <span className="text-sm text-muted-foreground">-</span>
          ),
      }),
```

Delete the mapping reminder block at the bottom of the component.

- [ ] **Step 5: Prefer stored line totals in display**

Keep the existing `lineTotal` display logic, but make sure it never recalculates when `row.original.lineTotal` is present:

```tsx
          const parsedLineTotal =
            row.original.lineTotal && Number.isFinite(Number.parseFloat(row.original.lineTotal))
              ? Number.parseFloat(row.original.lineTotal)
              : (Number.parseFloat(row.original.qty) || 0) *
                (Number.parseFloat(row.original.unitPrice) || 0)
```

- [ ] **Step 6: Update review route props and warnings**

In `src/routes/invoices/review/$jobId.tsx`:

Remove `ingredient` from `handleLineItemFieldChange`:

```ts
    field: 'qty' | 'unitPrice',
```

Remove this block:

```ts
    if (field === 'ingredient') {
      form.setFieldValue(`lineItems[${itemIndex}].matched`, Boolean(value.trim()))
    }
```

Update `<ReviewTable />` usage:

```tsx
                      <ReviewTable
                        lineItems={editableJob.lineItems}
                        disabled={isPipelineJobProcessing}
                        onQuantityChange={(itemId, value) => {
                          if (isDecimalInput(value)) {
                            handleLineItemFieldChange(itemId, value, 'qty')
                          }
                        }}
                        onUnitPriceChange={(itemId, value) => {
                          if (isDecimalInput(value)) {
                            handleLineItemFieldChange(itemId, value, 'unitPrice')
                          }
                        }}
                      />
```

Remove the footer message that says:

```tsx
还有 {readinessSummary.unmatchedLineItems} 项商品未映射到原料库。
```

- [ ] **Step 7: Stop recomputing matched from ingredient in form merge**

In `mergeReviewFormValues`, change line item merge to:

```ts
    lineItems: values.lineItems.map((item) => ({
      ...item,
      ingredient: '',
      matched: false,
    })),
```

- [ ] **Step 8: Run UI tests**

Run:

```bash
pnpm vitest run src/tests/invoice-review-rehydration.test.tsx
```

Expected: PASS.

---

### Task 5: Confirm Invoices Without Ingredient Mapping

**Files:**
- Modify: `src/lib/server/mutations/invoices.rpc.ts`
- Modify: `src/lib/server/mutations/invoices.ts`
- Test: `src/tests/real-data-integration.test.ts`
- Test: `src/tests/invoice-mock-store.test.ts`

- [ ] **Step 1: Add real-data integration coverage**

In `src/tests/real-data-integration.test.ts`, add a test near the existing invoice confirmation tests:

```ts
  test('confirming an invoice no longer requires ingredient mapping and preserves stored tax-included totals', async () => {
    const env = createFakeEnv({
      source_documents: [createSourceDocumentRow({ id: 'src-tax-included' })],
      intake_jobs: [
        createIntakeJobRow({
          id: 'job-tax-included',
          source_document_id: 'src-tax-included',
          stage: 'needs_review',
        }),
      ],
      extraction_results: [
        createExtractionResultRow({
          id: 'ext_job-tax-included',
          intake_job_id: 'job-tax-included',
          structured_json: JSON.stringify({
            schemaVersion: 'invoice-extraction-v2',
            pageCount: 1,
            documentKind: 'pdf',
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
                id: '802',
                name: 'ESTRELLA GALICIA 24x33 cl. RET',
                qty: '4.00',
                unit: 'un',
                unitPrice: '25.61',
                lineTotal: '102.45',
                taxRate: '21%',
                notes: 'Descuento: 42,33',
                ingredient: '',
                matched: false,
              },
            ],
            markdownText: '',
            provider: 'gemini',
            model: 'gemini-3.1-flash-lite',
          }),
        }),
      ],
    })

    const result = await confirmInvoiceReviewJobInDatabase(env, {
      jobId: 'job-tax-included',
      fileName: 'Factura venta FP26020968.pdf',
      uploadedAt: '2026-04-21T10:00:00.000Z',
      pageCount: 1,
      status: 'needs_review',
      stage: 'needs_review',
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
          id: '802',
          name: 'ESTRELLA GALICIA 24x33 cl. RET',
          qty: '4.00',
          unit: 'un',
          unitPrice: '25.61',
          lineTotal: '102.45',
          taxRate: '21%',
          notes: 'Descuento: 42,33',
          ingredient: '',
          matched: false,
        },
      ],
    })

    expect(result.ok).toBe(true)
    expect(result.readinessSummary.isReady).toBe(true)

    const tables = env.DB.snapshot()
    expect(tables.invoice_items[0]).toMatchObject({
      raw_unit_price: 25.61,
      raw_line_total: 102.45,
      ingredient_id: null,
      mapping_status: 'unmatched',
    })
  })
```

- [ ] **Step 2: Run the integration test and verify it fails**

Run:

```bash
pnpm vitest run src/tests/real-data-integration.test.ts -t "no longer requires ingredient mapping"
```

Expected: FAIL because readiness currently blocks unmapped items and `writeConfirmedInvoiceAccounting` recalculates line total.

- [ ] **Step 3: Persist stored line totals**

In `src/lib/server/mutations/invoices.rpc.ts`, replace the `raw_line_total` bind value:

```ts
          parseOptionalCurrencyAmount(item.lineTotal ?? '') ??
            calculateLineTotal(item.qty, item.unitPrice),
```

Keep `ingredient_id` as:

```ts
          item.ingredient.trim() || null,
```

Keep `mapping_status` as:

```ts
          item.ingredient.trim() ? 'matched' : 'unmatched',
```

This avoids a database migration while allowing invoice confirmation without mapping.

- [ ] **Step 4: Stop forcing matched in persistence**

In `persistInvoiceReviewDraft`, change `nextLineItems`:

```ts
  const nextLineItems = job.lineItems.map((item) => ({
    ...item,
    ingredient: '',
    matched: false,
  }))
```

In `src/lib/server/mutations/invoices.ts`, keep local confirm behavior based on `getInvoiceReadinessSummary`; Task 1 already makes mapping non-blocking.

- [ ] **Step 5: Run focused integration tests**

Run:

```bash
pnpm vitest run src/tests/real-data-integration.test.ts -t "invoice review D1 integration"
pnpm vitest run src/tests/invoice-mock-store.test.ts
```

Expected: PASS.

---

### Task 6: Final Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run all invoice-related tests**

Run:

```bash
pnpm vitest run src/tests/invoice-extraction.test.ts src/tests/invoice-review-rehydration.test.tsx src/tests/real-data-integration.test.ts src/tests/invoice-mock-store.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the app build**

Run:

```bash
pnpm run build
```

Expected: PASS.

- [ ] **Step 3: Manual PDF check with the user-provided file**

Use the existing upload flow with:

```text
/Users/zhuyuxia/Downloads/Factura venta FP26020968.pdf
```

Expected review values:

```json
{
  "factura_numero": "FP26020968",
  "fecha": "2026-04-21",
  "proveedor": "VINOS ISABEL MARIA CRUSAT SA",
  "items": [
    {
      "producto": "SERV. ENTREGA/RECOGIDA",
      "cantidad": "1.00",
      "precio_unitario": "4.22",
      "precio_total": "4.22",
      "iva": "21%"
    },
    {
      "producto": "ESTRELLA GALICIA 24x33 cl. RET",
      "cantidad": "4.00",
      "precio_unitario": "25.61",
      "precio_total": "102.45",
      "iva": "21%",
      "otros": "Descuento: 42,33"
    }
  ],
  "total_factura": "106.67"
}
```

The review screen must not show `原料映射`, and the confirm button must not be disabled because items have no ingredient mapping.

---

## Self-Review

- Spec coverage: the plan covers tax-included unit price, tax-included total price, IVA display, discount text, provider/customer metadata extraction, and removal of mapping from readiness/UI.
- Compatibility: old `ingredient` and `matched` fields remain in the draft shape so stored JSON and existing D1 tables do not require an immediate migration.
- Rounding rule: line total is authoritative; unit price is display-friendly and can differ from `qty * unitPrice` by 0.01 because invoice totals are rounded per line.
- Known constraint: this plan does not add new D1 columns for CIF/address. Those fields are stored in `extraction_results.structured_json` and shown in review, but confirmed invoice accounting still stores only the existing invoice table fields.
