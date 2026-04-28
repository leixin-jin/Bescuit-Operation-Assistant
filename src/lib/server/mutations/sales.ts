import { createServerFn } from '@tanstack/react-start'

import { getServerEnv, type AppBindings } from '@/lib/server/bindings'
import { requireD1Database, runD1 } from '@/lib/server/d1'
import {
  normalizeSalesDraftInput,
  type SalesDailyDraftInput,
  type SalesDailyRecord,
  type SalesRecordStatus,
} from '@/lib/server/app-domain'
import { upsertStoredSalesRecord } from '@/lib/server/demo-data'
import { assertDemoDataEnabled } from '@/lib/server/runtime-config'

export const saveSalesDraftServerFn = createServerFn({ method: 'POST' })
  .inputValidator((data: SalesDailyDraftInput) => data)
  .handler(async ({ data, context }) => saveSalesDraft(getServerEnv(context), data))

export const submitSalesEntryServerFn = createServerFn({ method: 'POST' })
  .inputValidator((data: SalesDailyDraftInput) => data)
  .handler(async ({ data, context }) =>
    submitSalesEntry(getServerEnv(context), data),
  )

export async function saveSalesDraft(
  envOrInput: Partial<AppBindings> | SalesDailyDraftInput | null | undefined,
  maybeInput?: SalesDailyDraftInput,
) {
  const { env, input } = resolveSalesMutationArgs(envOrInput, maybeInput)

  if (!env?.DB) {
    assertDemoDataEnabled(env, 'sales')
    return upsertStoredSalesRecord(input, 'draft')
  }

  return saveSalesDraftToDatabase(env, input)
}

export async function submitSalesEntry(
  envOrInput: Partial<AppBindings> | SalesDailyDraftInput | null | undefined,
  maybeInput?: SalesDailyDraftInput,
) {
  const { env, input } = resolveSalesMutationArgs(envOrInput, maybeInput)

  if (!env?.DB) {
    assertDemoDataEnabled(env, 'sales')
    return upsertStoredSalesRecord(input, 'submitted')
  }

  return submitSalesEntryToDatabase(env, input)
}

export async function saveSalesDraftToDatabase(
  env: Partial<AppBindings>,
  input: SalesDailyDraftInput,
) {
  return upsertSalesRecordInDatabase(env, input, 'draft')
}

export async function submitSalesEntryToDatabase(
  env: Partial<AppBindings>,
  input: SalesDailyDraftInput,
) {
  return upsertSalesRecordInDatabase(env, input, 'submitted')
}

async function upsertSalesRecordInDatabase(
  env: Partial<AppBindings>,
  input: SalesDailyDraftInput,
  status: SalesRecordStatus,
): Promise<SalesDailyRecord> {
  const db = requireD1Database(env, 'sales')
  const record = normalizeSalesDraftInput(input, status)

  await runD1(
    db,
    `/* sales:upsert */
    INSERT INTO sales_daily (
      id,
      date,
      total_amount,
      bbva_amount,
      caixa_amount,
      cash_amount,
      status,
      note,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      total_amount = excluded.total_amount,
      bbva_amount = excluded.bbva_amount,
      caixa_amount = excluded.caixa_amount,
      cash_amount = excluded.cash_amount,
      status = excluded.status,
      note = excluded.note,
      updated_at = excluded.updated_at`,
    [
      record.id,
      record.date,
      record.totalAmount,
      record.bbvaAmount,
      record.caixaAmount,
      record.cashAmount,
      record.status,
      record.note,
      record.updatedAt,
    ],
  )

  return record
}

function resolveSalesMutationArgs(
  envOrInput: Partial<AppBindings> | SalesDailyDraftInput | null | undefined,
  maybeInput: SalesDailyDraftInput | undefined,
) {
  if (maybeInput) {
    return {
      env: envOrInput as Partial<AppBindings> | null | undefined,
      input: maybeInput,
    }
  }

  return {
    env: undefined,
    input: envOrInput as SalesDailyDraftInput,
  }
}
