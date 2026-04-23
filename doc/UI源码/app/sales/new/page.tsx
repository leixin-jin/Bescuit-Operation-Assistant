"use client"

import { useState, useMemo } from "react"
import { CalendarIcon, Euro, ArrowLeft, Save, CheckCircle } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import Link from "next/link"

const paymentChannels = [
  { id: "bbva", name: "BBVA", color: "bg-blue-500" },
  { id: "caixa", name: "CAIXA", color: "bg-red-500" },
  { id: "efectivo", name: "EFECTIVO", color: "bg-emerald-500" },
]

export default function SalesEntryPage() {
  const [amounts, setAmounts] = useState<Record<string, string>>({
    bbva: "",
    caixa: "",
    efectivo: "",
  })
  const [date, setDate] = useState(new Date().toISOString().split("T")[0])
  const [notes, setNotes] = useState("")

  const total = useMemo(() => {
    return Object.values(amounts).reduce((sum, val) => {
      const num = parseFloat(val) || 0
      return sum + num
    }, 0)
  }, [amounts])

  const handleAmountChange = (channelId: string, value: string) => {
    // Only allow numbers and decimal point
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      setAmounts((prev) => ({ ...prev, [channelId]: value }))
    }
  }

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
          <h1 className="text-2xl font-bold">营业额录入</h1>
          <p className="mt-1 text-muted-foreground">
            录入今日各渠道收款金额
          </p>
        </div>

        <div className="mx-auto max-w-xl">
          {/* Date Selection */}
          <Card className="mb-6 rounded-xl">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarIcon className="h-4 w-4" />
                选择日期
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-lg"
              />
            </CardContent>
          </Card>

          {/* Amount Inputs */}
          <Card className="mb-6 rounded-xl">
            <CardHeader>
              <CardTitle className="text-base">收款渠道</CardTitle>
              <CardDescription>
                输入各渠道的收款金额（欧元）
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {paymentChannels.map((channel) => (
                <div key={channel.id} className="space-y-2">
                  <Label
                    htmlFor={channel.id}
                    className="flex items-center gap-2"
                  >
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${channel.color}`}
                    />
                    {channel.name}
                  </Label>
                  <div className="relative">
                    <Euro className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id={channel.id}
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={amounts[channel.id]}
                      onChange={(e) =>
                        handleAmountChange(channel.id, e.target.value)
                      }
                      className="rounded-lg pl-10 text-right text-lg font-medium"
                    />
                  </div>
                </div>
              ))}

              {/* Total */}
              <div className="mt-6 rounded-xl bg-secondary p-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-muted-foreground">
                    总计
                  </span>
                  <span className="text-2xl font-bold">
                    €{total.toFixed(2)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          <Card className="mb-6 rounded-xl">
            <CardHeader>
              <CardTitle className="text-base">备注（可选）</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder="添加备注信息..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="min-h-[100px] resize-none rounded-lg"
              />
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1 rounded-lg">
              <Save className="mr-2 h-4 w-4" />
              保存草稿
            </Button>
            <Button className="flex-1 rounded-lg">
              <CheckCircle className="mr-2 h-4 w-4" />
              确认提交
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
