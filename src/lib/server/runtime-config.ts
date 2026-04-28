import type { AppBindings } from '@/lib/server/bindings'

type RuntimeConfig = Partial<
  Pick<
    AppBindings,
    'ENABLE_DEMO_DATA' | 'VITE_ENABLE_DEMO_DATA' | 'MODE' | 'NODE_ENV'
  >
>

export function isProductionRuntime(env?: RuntimeConfig | null) {
  return getRuntimeMode(env) === 'production'
}

export function isDemoDataEnabled(env?: RuntimeConfig | null) {
  const explicitValue = parseBooleanFlag(
    env?.ENABLE_DEMO_DATA ??
      env?.VITE_ENABLE_DEMO_DATA ??
      getImportMetaEnvValue('VITE_ENABLE_DEMO_DATA') ??
      getProcessEnvValue('ENABLE_DEMO_DATA') ??
      getProcessEnvValue('VITE_ENABLE_DEMO_DATA'),
  )

  if (explicitValue !== null) {
    return explicitValue
  }

  return !isProductionRuntime(env)
}

export function assertDemoDataEnabled(
  env: RuntimeConfig | null | undefined,
  featureName: string,
) {
  if (isDemoDataEnabled(env)) {
    return
  }

  throw new Error(
    `${featureName} is not configured for real data, and demo/fallback data is disabled in production.`,
  )
}

function getRuntimeMode(env?: RuntimeConfig | null) {
  return (
    env?.MODE ??
    env?.NODE_ENV ??
    getImportMetaEnvValue('MODE') ??
    getProcessEnvValue('NODE_ENV') ??
    'development'
  )
}

function parseBooleanFlag(value: string | undefined) {
  if (typeof value === 'undefined') {
    return null
  }

  const normalizedValue = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalizedValue)) {
    return true
  }

  if (['0', 'false', 'no', 'off'].includes(normalizedValue)) {
    return false
  }

  return null
}

function getImportMetaEnvValue(key: string) {
  return import.meta.env?.[key]
}

function getProcessEnvValue(key: string) {
  if (typeof process === 'undefined') {
    return undefined
  }

  return process.env[key]
}
