"use client"

import { useState } from "react"
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react"
import Link from "next/link"
import { AppShell } from "@/components/app-shell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// Mock data for calendar
const generateMockData = () => {
  const data: Record<string, { income: number; expense: number }> = {}
  for (let i = 1; i <= 31; i++) {
    if (Math.random() > 0.3) {
      data[i.toString()] = {
        income: Math.floor(Math.random() * 1500) + 500,
        expense: Math.floor(Math.random() * 800) + 200,
      }
    }
  }
  return data
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"]

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [mockData] = useState(generateMockData)

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  const firstDayOfMonth = new Date(year, month, 1)
  const lastDayOfMonth = new Date(year, month + 1, 0)
  const daysInMonth = lastDayOfMonth.getDate()

  // Get the day of week for the first day (0 = Sunday, adjust for Monday start)
  let startDay = firstDayOfMonth.getDay() - 1
  if (startDay < 0) startDay = 6

  const navigateMonth = (direction: number) => {
    setCurrentDate(new Date(year, month + direction, 1))
  }

  const monthName = currentDate.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
  })

  // Calculate total income and expense for the month
  const monthTotal = Object.values(mockData).reduce(
    (acc, day) => ({
      income: acc.income + day.income,
      expense: acc.expense + day.expense,
    }),
    { income: 0, expense: 0 }
  )

  return (
    <AppShell>
      <div className="p-6 lg:p-10">
        {/* Page Header */}
        <div className="mb-8">
          <Link
            href="/"
            className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            返回首页
          </Link>
          <h1 className="text-2xl font-bold">日历概览</h1>
          <p className="mt-1 text-muted-foreground">
            查看每日收支摘要
          </p>
        </div>

        {/* Summary Cards */}
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <Card className="rounded-xl">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">本月总收入</p>
              <p className="mt-1 text-xl font-bold text-emerald-600">
                €{monthTotal.income.toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card className="rounded-xl">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">本月总支出</p>
              <p className="mt-1 text-xl font-bold text-red-500">
                €{monthTotal.expense.toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card className="rounded-xl">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">本月净利润</p>
              <p className="mt-1 text-xl font-bold">
                €{(monthTotal.income - monthTotal.expense).toLocaleString()}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Calendar */}
        <Card className="rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <CardTitle className="text-base">{monthName}</CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 rounded-lg"
                onClick={() => navigateMonth(-1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-lg"
                onClick={() => setCurrentDate(new Date())}
              >
                今天
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 rounded-lg"
                onClick={() => navigateMonth(1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {/* Weekday Headers */}
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

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-1">
              {/* Empty cells for days before the first of the month */}
              {Array.from({ length: startDay }).map((_, idx) => (
                <div key={`empty-${idx}`} className="aspect-square p-1" />
              ))}

              {/* Day cells */}
              {Array.from({ length: daysInMonth }).map((_, idx) => {
                const day = idx + 1
                const dayData = mockData[day.toString()]
                const isToday =
                  day === new Date().getDate() &&
                  month === new Date().getMonth() &&
                  year === new Date().getFullYear()

                return (
                  <div
                    key={day}
                    className={cn(
                      "aspect-square cursor-pointer rounded-lg border border-transparent p-1 transition-colors hover:border-primary/20 hover:bg-secondary/50",
                      isToday && "border-primary bg-primary/5"
                    )}
                  >
                    <div className="flex h-full flex-col">
                      <span
                        className={cn(
                          "text-xs font-medium",
                          isToday && "text-primary"
                        )}
                      >
                        {day}
                      </span>
                      {dayData && (
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
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Legend */}
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
