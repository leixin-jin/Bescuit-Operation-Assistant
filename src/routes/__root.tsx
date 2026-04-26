import { useState, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'

import { Toaster } from '@/components/ui/toaster'
import { createAppQueryClient } from '@/lib/query-client'
import appCss from '@/styles/globals.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: '酒吧经营助手 | Bescuit Operation Assistant',
      },
      {
        name: 'description',
        content:
          '专为酒吧老板设计的经营管理工具，覆盖营业额录入、发票处理和分析概览。',
      },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      {
        rel: 'icon',
        href: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        rel: 'icon',
        href: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      { rel: 'icon', href: '/icon.svg', type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/apple-icon.png' },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => createAppQueryClient())

  return (
    <html lang="zh-CN" className="bg-background" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <QueryClientProvider client={queryClient}>
          {children}
          <Toaster />
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  )
}
