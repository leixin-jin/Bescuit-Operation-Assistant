import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
import type { MonthlyAnalyticsSummary } from '@/lib/server/app-domain'
import { getMonthlyAnalyticsSummary } from '@/lib/server/queries/analytics'

export const Route = createFileRoute('/analytics/monthly')({
  loader: () => getMonthlyAnalyticsSummary(),
  component: AnalyticsMonthlyPage,
})

function AnalyticsMonthlyPage() {
  const loaderData = Route.useLoaderData()
  const [selectedMonth, setSelectedMonth] = useState(loaderData.selectedMonth)
  const { data: analyticsSummary = loaderData } = useQuery({
    queryKey: ['monthly-analytics', selectedMonth],
    queryFn: () => getMonthlyAnalyticsSummary(selectedMonth),
    initialData: selectedMonth === loaderData.selectedMonth ? loaderData : undefined,
  })

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
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-40 rounded-lg">
              <SelectValue placeholder="选择月份" />
            </SelectTrigger>
            <SelectContent>
              {analyticsSummary.monthOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="总收入"
            value={`€${analyticsSummary.totalIncome.toLocaleString()}`}
            description="较上月"
            trend={{ value: analyticsSummary.incomeTrend, isPositive: analyticsSummary.incomeTrend >= 0 }}
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <MetricCard
            title="总支出"
            value={`€${analyticsSummary.totalExpense.toLocaleString()}`}
            description="较上月"
            trend={{ value: Math.abs(analyticsSummary.expenseTrend), isPositive: analyticsSummary.expenseTrend <= 0 }}
            icon={<ShoppingCart className="h-4 w-4" />}
          />
          <MetricCard
            title="净利润"
            value={`€${analyticsSummary.totalNet.toLocaleString()}`}
            description="较上月"
            trend={{ value: analyticsSummary.netTrend, isPositive: analyticsSummary.netTrend >= 0 }}
            icon={<Euro className="h-4 w-4" />}
          />
          <MetricCard
            title="利润率"
            value={`${analyticsSummary.profitMargin.toFixed(1)}%`}
            description={`较上月 ${analyticsSummary.marginDelta >= 0 ? '+' : ''}${analyticsSummary.marginDelta.toFixed(1)}%`}
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
                    {renderDonutSegments(analyticsSummary.incomeBreakdown).map((segment) => (
                      <circle
                        key={segment.name}
                        cx="50"
                        cy="50"
                        r="40"
                        fill="none"
                        stroke={segment.color}
                        strokeWidth="20"
                        strokeDasharray={`${segment.length} 252`}
                        strokeDashoffset={segment.offset}
                      />
                    ))}
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-lg font-bold">
                      €{analyticsSummary.totalIncome.toLocaleString()}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col justify-center gap-3">
                  {analyticsSummary.incomeBreakdown.map((item, index) => (
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
                {analyticsSummary.expenseBreakdown.map((item, index) => (
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
                {analyticsSummary.weeklyTrend.map((week) => (
                  <div key={week.week} className="flex flex-1 flex-col items-center gap-2">
                    <div className="flex w-full items-end justify-center gap-1">
                      <div
                        className="w-8 rounded-t-md bg-emerald-500"
                        style={{
                          height: `${getBarHeight(
                            week.income,
                            analyticsSummary.weeklyTrend,
                          )}px`,
                        }}
                      />
                      <div
                        className="w-8 rounded-t-md bg-red-400"
                        style={{
                          height: `${getBarHeight(
                            week.expense,
                            analyticsSummary.weeklyTrend,
                          )}px`,
                        }}
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

function renderDonutSegments(
  entries: MonthlyAnalyticsSummary['incomeBreakdown'],
) {
  let offset = 0

  return entries.map((entry, index) => {
    const length = Math.round((entry.percentage / 100) * 252)
    const segment = {
      name: entry.name,
      length,
      offset: -offset,
      color: `hsl(var(--chart-${index + 1}))`,
    }

    offset += length
    return segment
  })
}

function getBarHeight(
  value: number,
  weeklyTrend: MonthlyAnalyticsSummary['weeklyTrend'],
) {
  const peakValue = Math.max(...weeklyTrend.flatMap((week) => [week.income, week.expense]), 1)
  return Math.max(16, (value / peakValue) * 150)
}
