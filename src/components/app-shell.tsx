"use client"

import type { ReactNode } from "react"

import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="bg-secondary/30">
        <header className="flex h-14 items-center gap-4 border-b bg-background px-6 lg:hidden">
          <SidebarTrigger className="-ml-2" />
          <span className="font-semibold">酒吧经营助手</span>
        </header>
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
