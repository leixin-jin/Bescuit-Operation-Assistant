import { describe, expect, test, vi } from 'vitest'

vi.mock('@tanstack/react-start/server-entry', () => ({
  default: {
    fetch: vi.fn(async () => new Response('app ok')),
  },
}))

vi.mock('@/lib/server/queries/document-preview', () => ({
  getInvoiceDocumentPreviewResponse: vi.fn(),
}))

vi.mock('@/lib/server/extraction', () => ({
  processInvoiceIntakeQueueMessage: vi.fn(),
}))

import server from '@/server'

const ctx = {} as ExecutionContext

describe('worker entry auth', () => {
  test('rejects production requests without an Authorization header', async () => {
    const env = {
      MODE: 'production',
      APP_BASIC_AUTH_USER: 'admin',
      APP_BASIC_AUTH_PASSWORD: 'secret',
    }

    const response = await server.fetch(
      new Request('https://app.example.test/'),
      env,
      ctx,
    )

    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toContain('Basic')
  })

  test('allows production requests with valid Basic credentials', async () => {
    const env = {
      MODE: 'production',
      APP_BASIC_AUTH_USER: 'admin',
      APP_BASIC_AUTH_PASSWORD: 'secret',
    }

    const response = await server.fetch(
      new Request('https://app.example.test/', {
        headers: {
          Authorization: `Basic ${btoa('admin:secret')}`,
        },
      }),
      env,
      ctx,
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('app ok')
  })

  test('keeps development requests open without auth secrets', async () => {
    const response = await server.fetch(new Request('https://app.example.test/'), {}, ctx)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('app ok')
  })
})
