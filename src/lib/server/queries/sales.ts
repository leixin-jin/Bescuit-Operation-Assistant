import { createServerFn } from '@tanstack/react-start'

import { getServerEnv, type AppBindings } from '@/lib/server/bindings'
import { allD1, firstD1, requireD1Database } from '@/lib/server/d1'
import {
  getMadridTodayInputValue,
  paymentChannels,
  type SalesDailyRecord,
  type SalesRecordStatus,
} from '@/lib/server/app-domain'
import {
  getStoredSalesRecord,
  listStoredSalesRecords,
} from '@/lib/server/demo-data'
import { assertDemoDataEnabled } from '@/lib/server/runtime-config'

interface SalesDailyRow {
  id: string
  date: string
  totalAmount: number
  bbvaAmount: number
  caixaAmount: number
  cashAmount: number
  status: string
  note: string
  updatedAt: string
}

export const getSalesEntryPageDataServerFn = createServerFn({ method: 'GET' })
  .inputValidator((data: { date?: string } | undefined) => data ?? {})
  .handler(async ({ data, context }) =>
    getSalesEntryPageData(getServerEnv(context), data?.date),
  )

export const getSalesRecordServerFn = createServerFn({ method: 'GET' })
  .inputValidator((data: { date: string }) => data)
  .handler(async ({ data, context }) =>
    getSalesRecord(getServerEnv(context), data.date),
  )

export async function getSalesEntryPageData(
  envOrDate?: Partial<AppBindings> | string | null,
  maybeDate?: string,
) {
  const { env, date } = resolveSalesQueryArgs(envOrDate, maybeDate)

  return {
    date,
    paymentChannels,
    existingRecord: await getSalesRecord(env, date),
  }
}

export async function getSalesRecord(
  envOrDate: Partial<AppBindings> | string | null | undefined,
  maybeDate?: string,
) {
  const { env, date } = resolveSalesQueryArgs(envOrDate, maybeDate)

  if (!env?.DB) {
    assertDemoDataEnabled(env, 'sales')
    return getStoredSalesRecord(date) ?? null
  }

  return getSalesRecordFromDatabase(env, date)
}

export async function listRecentSalesRecords(
  envOrLimit: Partial<AppBindings> | number | null | undefined,
  maybeLimit = 7,
): Promise<SalesDailyRecord[]> {
  const env =
    typeof envOrLimit === 'number' ? undefined : (envOrLimit ?? undefined)
  const limit = typeof envOrLimit === 'number' ? envOrLimit : maybeLimit

  if (!env?.DB) {
    assertDemoDataEnabled(env, 'sales')
    return listStoredSalesRecords().slice(0, limit)
  }

  return listRecentSalesRecordsFromDatabase(env, limit)
}

export async function getSalesRecordFromDatabase(
  env: Partial<AppBindings>,
  date: string,
) {
  const db = requireD1Database(env, 'sales')
  const row = await firstD1<SalesDailyRow>(
    db,
    `/* sales:get-by-date */
    SELECT
      id,
      date,
      total_amount AS totalAmount,
      bbva_amount AS bbvaAmount,
      caixa_amount AS caixaAmount,
      cash_amount AS cashAmount,
      status,
      note,
      updated_at AS updatedAt
    FROM sales_daily
    WHERE date = ?
    LIMIT 1`,
    [date],
  )

  return row ? toSalesRecord(row) : null
}

export async function listRecentSalesRecordsFromDatabase(
  env: Partial<AppBindings>,
  limit = 7,
): Promise<SalesDailyRecord[]> {
  const db = requireD1Database(env, 'sales')
  const rows = await allD1<SalesDailyRow>(
    db,
    `/* sales:list-recent */
    SELECT
      id,
      date,
      total_amount AS totalAmount,
      bbva_amount AS bbvaAmount,
      caixa_amount AS caixaAmount,
      cash_amount AS cashAmount,
      status,
      note,
      updated_at AS updatedAt
    FROM sales_daily
    ORDER BY date DESC
    LIMIT ?`,
    [limit],
  )

  return rows.map(toSalesRecord)
}

function toSalesRecord(row: SalesDailyRow): SalesDailyRecord {
  return {
    id: row.id,
    date: row.date,
    totalAmount: row.totalAmount,
    bbvaAmount: row.bbvaAmount,
    caixaAmount: row.caixaAmount,
    cashAmount: row.cashAmount,
    status: normalizeSalesRecordStatus(row.status),
    note: row.note,
    updatedAt: row.updatedAt,
  }
}

function normalizeSalesRecordStatus(status: string): SalesRecordStatus {
  return status === 'draft' ? 'draft' : 'submitted'
}

function resolveSalesQueryArgs(
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
