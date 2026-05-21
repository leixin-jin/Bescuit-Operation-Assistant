export interface AppBindings {
  DB?: D1Database
  RAW_DOCUMENTS?: R2Bucket
  INTAKE_QUEUE?: Queue<unknown>
  AI?: Ai
  INVOICE_EXTRACTION_PROVIDER?: string
  INVOICE_EXTRACTION_FALLBACK_PROVIDER?: string
  INVOICE_EXTRACTION_MODEL?: string
  INVOICE_EXTRACTION_TIMEOUT_MS?: string
  INVOICE_PDF_INPUT_MODE?: string
  GEMINI_API_KEY?: string
  GEMINI_API_BASE_URL?: string
  AI_GATEWAY_BASE_URL?: string
  AI_GATEWAY_API_TOKEN?: string
  ENABLE_DEMO_DATA?: string
  VITE_ENABLE_DEMO_DATA?: string
  APP_BASIC_AUTH_USER?: string
  APP_BASIC_AUTH_PASSWORD?: string
  MODE?: string
  NODE_ENV?: string
}

export interface StartRequestContext {
  env: AppBindings
  ctx: ExecutionContext
}

declare module '@tanstack/react-start' {
  interface Register {
    server: {
      requestContext: StartRequestContext
    }
  }
}

export function hasInvoiceIntakePipelineBindings(
  env?: Partial<AppBindings> | null,
): env is AppBindings & {
  DB: D1Database
  RAW_DOCUMENTS: R2Bucket
  INTAKE_QUEUE: Queue<unknown>
} {
  return Boolean(env?.DB && env?.RAW_DOCUMENTS && env?.INTAKE_QUEUE)
}

export function hasWorkersAiBinding(
  env?: Partial<AppBindings> | null,
): env is AppBindings & { AI: Ai } {
  return Boolean(env?.AI)
}

export function requireBinding<T>(
  binding: T | null | undefined,
  bindingName: string,
): T {
  if (!binding) {
    throw new Error(`Missing Cloudflare binding: ${bindingName}`)
  }

  return binding
}

export function getServerEnv(context: unknown) {
  return (context as { env?: AppBindings } | null | undefined)?.env
}
