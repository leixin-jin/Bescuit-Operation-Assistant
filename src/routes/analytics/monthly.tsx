import { Link, createFileRoute } from '@tanstack/react-router'
import {
  ArrowLeft,
  Euro,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'

import { AppShell } from '@/components/app-shell'
import { MetricCard } from '@/components/metric-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const incomeData = [
  { name: 'BBVA', value: 12500, percentage: 45 },
  { name: 'CAIXA', value: 8300, percentage: 30 },
  { name: 'EFECTIVO', value: 6900, percentage: 25 },
]

const expenseData = [
  { name: '酒水采购', value: 8500, percentage: 55 },
  { name: '食材', value: 3200, percentage: 21 },
  { name: '人工', value: 2400, percentage: 16 },
  { name: '其他', value: 1200, percentage: 8 },
]

const weeklyData = [
  { week: '第1周', income: 6200, expense: 3800 },
  { week: '第2周', income: 7100, expense: 4200 },
  { week: '第3周', income: 6800, expense: 3900 },
  { week: '第4周', income: 7600, expense: 4100 },
]

export const Route = createFileRoute('/analytics/monthly')({
  component: AnalyticsMonthlyPage,
})

function AnalyticsMonthlyPage() {
  return (
    <AppShell>
      <div className="p-6 lg:p-10">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link
              to="/"
              className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              返回首页
            </Link>
            <h1 className="text-2xl font-bold">数据分析</h1>
            <p className="mt-1 text-muted-foreground">查看收入与支出的详细分析</p>
          </div>
          <Select defaultValue="2024-01">
            <SelectTrigger className="w-40 rounded-lg">
              <SelectValue placeholder="选择月份" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2024-01">2024年1月</SelectItem>
              <SelectItem value="2023-12">2023年12月</SelectItem>
              <SelectItem value="2023-11">2023年11月</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="总收入"
            value="€27,700"
            description="较上月"
            trend={{ value: 12.5, isPositive: true }}
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <MetricCard
            title="总支出"
            value="€15,300"
            description="较上月"
            trend={{ value: 3.2, isPositive: false }}
            icon={<ShoppingCart className="h-4 w-4" />}
          />
          <MetricCard
            title="净利润"
            value="€12,400"
            description="较上月"
            trend={{ value: 8.7, isPositive: true }}
            icon={<Euro className="h-4 w-4" />}
          />
          <MetricCard
            title="利润率"
            value="44.8%"
            description="较上月 +2.1%"
            icon={<TrendingUp className="h-4 w-4" />}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="rounded-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4 text-emerald-600" />
                收入结构
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-8">
                <div className="relative h-40 w-40 shrink-0">
                  <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      fill="none"
                      stroke="hsl(var(--chart-1))"
                      strokeWidth="20"
                      strokeDasharray="113 252"
                      strokeDashoffset="0"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      fill="none"
                      stroke="hsl(var(--chart-2))"
                      strokeWidth="20"
                      strokeDasharray="75 252"
                      strokeDashoffset="-113"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      fill="none"
                      stroke="hsl(var(--chart-3))"
                      strokeWidth="20"
                      strokeDasharray="63 252"
                      strokeDashoffset="-188"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-lg font-bold">€27.7K</span>
                  </div>
                </div>
                <div className="flex flex-col justify-center gap-3">
                  {incomeData.map((item, index) => (
                    <div key={item.name} className="flex items-center gap-3">
                      <div
                        className="h-3 w-3 rounded-full"
                        style={{
                          backgroundColor: `hsl(var(--chart-${index + 1}))`,
                        }}
                      />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{item.name}</p>
                        <p className="text-xs text-muted-foreground">
                          €{item.value.toLocaleString()} ({item.percentage}%)
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingDown className="h-4 w-4 text-red-500" />
                支出结构
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {expenseData.map((item, index) => (
                  <div key={item.name}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span>{item.name}</span>
                      <span className="font-medium">€{item.value.toLocaleString()}</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${item.percentage}%`,
                          backgroundColor: `hsl(var(--chart-${index + 1}))`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-xl lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">周收支趋势</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex h-48 items-end justify-around gap-4">
                {weeklyData.map((week) => (
                  <div key={week.week} className="flex flex-1 flex-col items-center gap-2">
                    <div className="flex w-full items-end justify-center gap-1">
                      <div
                        className="w-8 rounded-t-md bg-emerald-500"
                        style={{ height: `${(week.income / 8000) * 150}px` }}
                      />
                      <div
                        className="w-8 rounded-t-md bg-red-400"
                        style={{ height: `${(week.expense / 8000) * 150}px` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">{week.week}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-center gap-6">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-sm bg-emerald-500" />
                  <span className="text-sm text-muted-foreground">收入</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-sm bg-red-400" />
                  <span className="text-sm text-muted-foreground">支出</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  )
}
