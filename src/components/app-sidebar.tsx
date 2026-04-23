"use client"

import { Link, useRouterState } from "@tanstack/react-router"
import {
  Home,
  Receipt,
  TrendingUp,
  Calendar,
  Wine,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const navItems = [
  { title: "首页", href: "/", icon: Home },
  { title: "营业额录入", href: "/sales/new", icon: TrendingUp },
  { title: "发票核对", href: "/invoices/review", icon: Receipt },
  { title: "数据分析", href: "/analytics/monthly", icon: TrendingUp },
  { title: "日历概览", href: "/analytics/calendar", icon: Calendar },
]

export function AppSidebar() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  const isActiveRoute = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`)

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border px-6 py-4">
        <Link to="/" className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary">
            <Wine className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-base font-semibold">酒吧经营助手</h1>
            <p className="text-xs text-muted-foreground">Bar Operations</p>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="px-4 text-xs font-medium text-muted-foreground">
            功能导航
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActiveRoute(item.href)}
                    className={cn(
                      "mx-2 rounded-lg transition-colors",
                      isActiveRoute(item.href) && "bg-sidebar-accent"
                    )}
                  >
                    <Link to={item.href}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
