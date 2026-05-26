import { createServerFn } from '@tanstack/react-start'

import { getServerEnv, type AppBindings } from '@/lib/server/bindings'
import { allD1, requireD1Database } from '@/lib/server/d1'
import {
  listStoredExpenseSupplierOptions,
  listStoredManualExpenses,
} from '@/lib/server/demo-data'
import {
  getMadridTodayInputValue,
  type ExpenseEntryPageData,
  type ManualExpenseRecord,
} from '@/lib/server/app-domain'
import { assertDemoDataEnabled } from '@/lib/server/runtime-config'

interface SupplierOptionRow {
  supplierName: string
}

interface ManualExpenseRow {
  id: string
  entryDate: string
  amount: number
  vendor: string | null
  note: string | null
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
    return {
      date,
      supplierOptions: listStoredExpenseSupplierOptions(),
      recentExpenses: listStoredManualExpenses(date),
    }
  }

  const db = requireD1Database(env, 'expenses')
  const supplierRows = await allD1<SupplierOptionRow>(
    db,
    `/* expenses:supplier-options */
    SELECT DISTINCT supplier_name AS supplierName
    FROM invoices
    WHERE TRIM(supplier_name) <> ''
    ORDER BY supplier_name COLLATE NOCASE ASC`,
  )
  const expenseRows = await allD1<ManualExpenseRow>(
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

  return {
    date,
    supplierOptions: supplierRows.map((row) => row.supplierName),
    recentExpenses: expenseRows.map(toManualExpenseRecord),
  }
}

function toManualExpenseRecord(row: ManualExpenseRow): ManualExpenseRecord {
  return {
    id: row.id,
    entryDate: row.entryDate,
    entryType: 'expense',
    category: 'manual',
    amount: row.amount,
    vendor: row.vendor ?? '',
    note: row.note ?? '',
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
    return {
      env: undefined,
      date: envOrDate,
    }
  }

  return {
    env: envOrDate ?? undefined,
    date: maybeDate ?? getMadridTodayInputValue(),
  }
}
