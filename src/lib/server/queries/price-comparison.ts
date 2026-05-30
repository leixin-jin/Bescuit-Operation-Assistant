import type { AppBindings } from '@/lib/server/bindings'
import { allD1 } from '@/lib/server/d1'
import {
  roundCurrency,
  type InvoiceItemPriceComparison,
} from '@/lib/server/app-domain'

interface PreviousValidPriceRow {
  previousPrice: number
  previousInvoiceDate: string
  previousSupplierName: string
}

export interface InvoiceItemPriceComparisonInput {
  invoiceDate: string
  rawProductName: string
  ingredientId: string | null
  unitPrice: number | null
  excludeFromPriceTracking?: boolean
}

export async function getInvoiceItemPriceComparison(
  env: Partial<AppBindings> | null | undefined,
  input: InvoiceItemPriceComparisonInput,
): Promise<InvoiceItemPriceComparison> {
  if (input.excludeFromPriceTracking === true) {
    return { status: 'excluded' }
  }

  const currentPrice = input.unitPrice

  if (!env?.DB || currentPrice === null) {
    return { status: 'first_record' }
  }

  const previousRows = await allD1<PreviousValidPriceRow>(
    env.DB,
    `/* invoice:previous-valid-price */
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
    LIMIT 1`,
    [
      input.invoiceDate,
      input.ingredientId,
      input.ingredientId,
      input.ingredientId,
      input.rawProductName,
    ],
  )
  const previousRow = previousRows[0]

  if (!previousRow) {
    return { status: 'first_record' }
  }

  const previousPrice = Number(previousRow.previousPrice)
  const delta = roundCurrency(currentPrice - previousPrice)
  const deltaPercent =
    previousPrice === 0 ? 0 : roundCurrency((delta / previousPrice) * 100)
  const sharedFields = {
    previousPrice,
    previousInvoiceDate: previousRow.previousInvoiceDate,
    previousSupplierName: previousRow.previousSupplierName,
    delta,
    deltaPercent,
  }

  if (delta === 0) {
    return {
      status: 'unchanged',
      ...sharedFields,
      direction: 'same',
    }
  }

  return {
    status: 'changed',
    ...sharedFields,
    direction: delta > 0 ? 'up' : 'down',
  }
}
