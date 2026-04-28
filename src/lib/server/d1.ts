import type { AppBindings } from '@/lib/server/bindings'

export function requireD1Database(
  env: Partial<AppBindings> | null | undefined,
  featureName: string,
) {
  if (!env?.DB) {
    throw new Error(`Missing Cloudflare binding: DB for ${featureName}.`)
  }

  return env.DB
}

export async function allD1<T>(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
) {
  const statement = bindD1(db, sql, params)
  const result = await statement.all<T>()
  return result.results ?? []
}

export async function firstD1<T>(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
) {
  const statement = bindD1(db, sql, params)
  return (await statement.first<T>()) ?? null
}

export async function runD1(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
) {
  const statement = bindD1(db, sql, params)
  await statement.run()
}

function bindD1(db: D1Database, sql: string, params: unknown[]) {
  const statement = db.prepare(sql)
  return params.length > 0 ? statement.bind(...params) : statement
}
