import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'

import * as schema from '@/lib/db/schema'

export interface DatabaseBindings {
  DB?: D1Database
}

export type AppDatabase = DrizzleD1Database<typeof schema>

export function getDb(env?: DatabaseBindings | null) {
  if (!env?.DB) {
    return null
  }

  return drizzle(env.DB, { schema })
}
