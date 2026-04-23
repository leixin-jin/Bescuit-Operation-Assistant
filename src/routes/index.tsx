import { Link, createFileRoute } from '@tanstack/react-router'
import { Camera, CheckCircle2, Clock, TrendingUp, Wine } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  const today = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    timeZone: 'Europe/Madrid',
  }).format(new Date())

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b bg-background px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
              <Wine className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold">酒吧经营助手</h1>
              <p className="text-sm text-muted-foreground">Bar Operations Assistant</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">{today}</p>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center p-6">
        <div className="mx-auto w-full max-w-4xl">
          <div className="mb-10 text-center">
            <h2 className="text-2xl font-bold text-balance">今天要做什么？</h2>
            <p className="mt-2 text-muted-foreground">选择一个快捷入口开始您的工作</p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Link to="/sales/new" className="group">
              <Card className="h-full cursor-pointer rounded-xl border-2 border-transparent transition-all hover:border-primary/20 hover:shadow-lg">
                <CardHeader className="pb-4">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-emerald-100">
                    <TrendingUp className="h-7 w-7 text-emerald-600" />
                  </div>
                  <CardTitle className="text-xl">输入今日营业额</CardTitle>
                  <CardDescription className="text-base">
                    录入 BBVA、CAIXA、EFECTIVO 等渠道收款
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    variant="secondary"
                    className="w-full rounded-lg transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
                  >
                    开始录入
                  </Button>
                </CardContent>
              </Card>
            </Link>

            <Link to="/invoices/new" className="group">
              <Card className="h-full cursor-pointer rounded-xl border-2 border-transparent transition-all hover:border-primary/20 hover:shadow-lg">
                <CardHeader className="pb-4">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-blue-100">
                    <Camera className="h-7 w-7 text-blue-600" />
                  </div>
                  <CardTitle className="text-xl">输入一张发票</CardTitle>
                  <CardDescription className="text-base">
                    拍照或上传发票，并进入独立的核对工作台
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button className="w-full rounded-lg">
                    <Camera className="mr-2 h-4 w-4" />
                    开始 intake
                  </Button>
                </CardContent>
              </Card>
            </Link>
          </div>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/analytics/monthly">
              <Button variant="ghost" size="sm" className="rounded-lg text-muted-foreground">
                查看本月分析
              </Button>
            </Link>
            <Link to="/analytics/calendar">
              <Button variant="ghost" size="sm" className="rounded-lg text-muted-foreground">
                日历概览
              </Button>
            </Link>
          </div>
        </div>
      </main>

      <footer className="border-t bg-background px-6 py-4">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-4">
          <Badge variant="secondary" className="gap-1.5 rounded-lg px-3 py-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            <span>已同步</span>
          </Badge>
          <Badge variant="secondary" className="gap-1.5 rounded-lg px-3 py-1.5">
            <Clock className="h-3.5 w-3.5" />
            <span>上次操作: 10 分钟前</span>
          </Badge>
          <Badge variant="secondary" className="gap-1.5 rounded-lg px-3 py-1.5">
            <span className="text-muted-foreground">本月已录入</span>
            <span className="font-semibold">23 张发票</span>
          </Badge>
        </div>
      </footer>
    </div>
  )
}
