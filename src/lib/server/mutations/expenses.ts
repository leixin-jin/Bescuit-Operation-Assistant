import { createServerFn } from '@tanstack/react-start'

import { getServerEnv, type AppBindings } from '@/lib/server/bindings'
import { requireD1Database, runD1 } from '@/lib/server/d1'
import { createStoredManualExpense } from '@/lib/server/demo-data'
import {
  normalizeManualExpenseInput,
  type ManualExpenseDraftInput,
} from '@/lib/server/app-domain'
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

  if (!env?.DB) {
    assertDemoDataEnabled(env, 'expenses')
    return createStoredManualExpense(input)
  }

  const record = normalizeManualExpenseInput(input)
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
