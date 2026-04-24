import { useEffect, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'

import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { CalendarAnalyticsSummary } from '@/lib/server/app-domain'
import { getCalendarAnalyticsSummary } from '@/lib/server/queries/analytics'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

export const Route = createFileRoute('/analytics/calendar')({
  loader: () => getCalendarAnalyticsSummary(),
  component: AnalyticsCalendarPage,
})

function AnalyticsCalendarPage() {
  const loaderData = Route.useLoaderData()
  const [selectedMonth, setSelectedMonth] = useState(loaderData.selectedMonth)
  const [calendarSummary, setCalendarSummary] =
    useState<CalendarAnalyticsSummary>(loaderData)

  useEffect(() => {
    let isCancelled = false

    void getCalendarAnalyticsSummary(selectedMonth).then((nextSummary) => {
      if (!isCancelled) {
        setCalendarSummary(nextSummary)
      }
    })

    return () => {
      isCancelled = true
    }
  }, [selectedMonth])

  const currentDate = toMonthDate(selectedMonth)
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const firstDayOfMonth = new Date(year, month, 1)
  const lastDayOfMonth = new Date(year, month + 1, 0)
  const daysInMonth = lastDayOfMonth.getDate()
  let startDay = firstDayOfMonth.getDay() - 1

  if (startDay < 0) {
    startDay = 6
  }

  const today = getTodayReferenceDate()

  return (
    <AppShell>
      <div className="p-6 lg:p-10">
        <div className="mb-8">
          <Link
            to="/"
            className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            返回首页
          </Link>
          <h1 className="text-2xl font-bold">日历概览</h1>
          <p className="mt-1 text-muted-foreground">查看每日收支摘要</p>
        </div>

        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <Card className="rounded-xl">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">本月总收入</p>
              <p className="mt-1 text-xl font-bold text-emerald-600">
                €{calendarSummary.totalIncome.toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card className="rounded-xl">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">本月总支出</p>
              <p className="mt-1 text-xl font-bold text-red-500">
                €{calendarSummary.totalExpense.toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card className="rounded-xl">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">本月净利润</p>
              <p className="mt-1 text-xl font-bold">
                €{(calendarSummary.totalIncome - calendarSummary.totalExpense).toLocaleString()}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <CardTitle className="text-base">{calendarSummary.monthName}</CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 rounded-lg"
                onClick={() => setSelectedMonth(shiftMonth(selectedMonth, -1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-lg"
                onClick={() => setSelectedMonth(getTodayReferenceDate().toISOString().slice(0, 7))}
              >
                今天
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 rounded-lg"
                onClick={() => setSelectedMonth(shiftMonth(selectedMonth, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-2 grid grid-cols-7 gap-1">
              {WEEKDAYS.map((day) => (
                <div
                  key={day}
                  className="py-2 text-center text-xs font-medium text-muted-foreground"
                >
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: startDay }).map((_, index) => (
                <div key={`empty-${index}`} className="aspect-square p-1" />
              ))}

              {Array.from({ length: daysInMonth }).map((_, index) => {
                const day = index + 1
                const dayData = calendarSummary.days[day.toString()]
                const isToday =
                  day === today.getDate() &&
                  month === today.getMonth() &&
                  year === today.getFullYear()

                return (
                  <div
                    key={day}
                    className={cn(
                      'aspect-square cursor-pointer rounded-lg border border-transparent p-1 transition-colors hover:border-primary/20 hover:bg-secondary/50',
                      isToday && 'border-primary bg-primary/5',
                    )}
                  >
                    <div className="flex h-full flex-col">
                      <span className={cn('text-xs font-medium', isToday && 'text-primary')}>
                        {day}
                      </span>
                      {dayData ? (
                        <div className="mt-auto space-y-0.5">
                          <div className="flex items-center gap-1">
                            <span className="h-1 w-1 rounded-full bg-emerald-500" />
                            <span className="truncate text-[10px] text-emerald-600">
                              {dayData.income}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="h-1 w-1 rounded-full bg-red-400" />
                            <span className="truncate text-[10px] text-red-500">
                              {dayData.expense}
                            </span>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="mt-4 flex justify-center gap-6 border-t pt-4">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-xs text-muted-foreground">收入</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-red-400" />
                <span className="text-xs text-muted-foreground">支出</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}

function shiftMonth(month: string, offset: number) {
  const date = toMonthDate(month)
  date.setMonth(date.getMonth() + offset)
  return date.toISOString().slice(0, 7)
}

function toMonthDate(month: string) {
  const [year, monthNumber] = month.split('-').map((value) => Number.parseInt(value, 10))
  return new Date(year, monthNumber - 1, 1, 12)
}

function getTodayReferenceDate() {
  const dateString = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid',
  }).format(new Date())

  return new Date(`${dateString}T12:00:00`)
}
