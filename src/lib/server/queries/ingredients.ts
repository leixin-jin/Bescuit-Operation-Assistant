import { createServerFn } from '@tanstack/react-start'

import type { IngredientOption } from '@/lib/server/app-domain'
import { getServerEnv, type AppBindings } from '@/lib/server/bindings'
import { allD1, requireD1Database } from '@/lib/server/d1'
import { demoIngredientOptions } from '@/lib/server/demo-data'
import { assertDemoDataEnabled } from '@/lib/server/runtime-config'

export const listIngredientOptionsServerFn = createServerFn({
  method: 'GET',
}).handler(async ({ context }) => listIngredientOptions(getServerEnv(context)))

export async function listIngredientOptions(
  env?: Partial<AppBindings> | null,
): Promise<IngredientOption[]> {
  if (!env?.DB) {
    assertDemoDataEnabled(env, 'ingredients')
    return demoIngredientOptions
  }

  return listIngredientOptionsFromDatabase(env)
}

export async function listIngredientOptionsFromDatabase(
  env: Partial<AppBindings>,
): Promise<IngredientOption[]> {
  const db = requireD1Database(env, 'ingredients')
  return allD1<IngredientOption>(
    db,
    `/* ingredients:list-options */
    SELECT
      id AS value,
      name AS label
    FROM ingredients
    ORDER BY name ASC`,
  )
}
