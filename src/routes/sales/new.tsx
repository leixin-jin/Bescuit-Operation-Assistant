import { useEffect, useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { ArrowLeft, CalendarIcon, CheckCircle, Euro, Save } from 'lucide-react'

import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { SalesDailyDraftInput, SalesDailyRecord } from '@/lib/server/app-domain'
import { getSalesEntryPageData } from '@/lib/server/queries/sales'
import { saveSalesDraft, submitSalesEntry } from '@/lib/server/mutations/sales'

export const Route = createFileRoute('/sales/new')({
  loader: () => getSalesEntryPageData(),
  component: SalesEntryPage,
})

function SalesEntryPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const loaderData = Route.useLoaderData()
  const [businessDate, setBusinessDate] = useState(loaderData.date)
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)

  const salesEntryQuery = useQuery({
    queryKey: ['sales-entry', businessDate],
    queryFn: () => getSalesEntryPageData(businessDate),
    initialData: businessDate === loaderData.date ? loaderData : undefined,
  })
  const salesEntryData = salesEntryQuery.data ?? loaderData

  const saveSalesMutation = useMutation({
    mutationFn: async ({
      mode,
      value,
    }: {
      mode: SalesPersistMode
      value: SalesFormValues
    }) => {
      const payload = toSalesPayload(value)
      return mode === 'draft' ? saveSalesDraft(payload) : submitSalesEntry(payload)
    },
    onSuccess: async (savedRecord, variables) => {
      form.reset(createSalesFormValues(savedRecord, savedRecord.date))
      setBusinessDate(savedRecord.date)
      setFeedbackMessage(
        variables.mode === 'draft' ? '营业额草稿已保存。' : '今日营业额已提交。',
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['sales-entry'] }),
        queryClient.invalidateQueries({ queryKey: ['monthly-analytics'] }),
        queryClient.invalidateQueries({ queryKey: ['calendar-analytics'] }),
        router.invalidate(),
      ])
    },
  })

  const form = useForm({
    defaultValues: createSalesFormValues(
      salesEntryData.existingRecord,
      salesEntryData.date,
    ),
    onSubmitMeta: { mode: 'submit' as SalesPersistMode },
    onSubmit: async ({ value, meta }) => {
      await saveSalesMutation.mutateAsync({ mode: meta.mode, value })
    },
  })

  useEffect(() => {
    form.reset(createSalesFormValues(salesEntryData.existingRecord, salesEntryData.date))
    setFeedbackMessage(
      salesEntryData.existingRecord
        ? salesEntryData.existingRecord.status === 'draft'
          ? '已加载该日期的营业额草稿。'
          : '已加载该日期的已提交营业额。'
        : null,
    )
  }, [form, salesEntryData.date, salesEntryData.existingRecord])

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
          <h1 className="text-2xl font-bold">营业额录入</h1>
          <p className="mt-1 text-muted-foreground">录入今日各渠道收款金额</p>
        </div>

        <div className="mx-auto max-w-xl">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void form.handleSubmit({ mode: 'submit' })
            }}
          >
          <Card className="mb-6 rounded-xl">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarIcon className="h-4 w-4" />
                选择日期
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form.Field
                name="businessDate"
                children={(field) => (
                  <Input
                    type="date"
                    value={field.state.value}
                    onChange={(event) => {
                      field.handleChange(event.target.value)
                      setBusinessDate(event.target.value)
                    }}
                    className="rounded-lg"
                  />
                )}
              />
            </CardContent>
          </Card>

          <Card className="mb-6 rounded-xl">
            <CardHeader>
              <CardTitle className="text-base">收款渠道</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {loaderData.paymentChannels.map((channel) => (
                <div key={channel.id} className="space-y-2">
                  <Label htmlFor={channel.id} className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${channel.color}`} />
                    {channel.name}
                  </Label>
                  <div className="relative">
                    <Euro className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <form.Field
                      name={channel.id}
                      children={(field) => (
                        <Input
                          id={channel.id}
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={field.state.value}
                          onChange={(event) => {
                            const nextValue = event.target.value
                            if (isDecimalInput(nextValue)) {
                              field.handleChange(nextValue)
                            }
                          }}
                          className="rounded-lg pl-10 text-right text-lg font-medium"
                        />
                      )}
                    />
                  </div>
                </div>
              ))}

              <div className="mt-6 rounded-xl bg-secondary p-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-muted-foreground">总计</span>
                  <form.Subscribe
                    selector={(state) => getSalesTotal(state.values)}
                    children={(total) => (
                      <span className="text-2xl font-bold">€{total.toFixed(2)}</span>
                    )}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="mb-6 rounded-xl">
            <CardHeader>
              <CardTitle className="text-base">备注（可选）</CardTitle>
            </CardHeader>
            <CardContent>
              <form.Field
                name="notes"
                children={(field) => (
                  <Textarea
                    placeholder="添加备注信息..."
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    className="min-h-[100px] resize-none rounded-lg"
                  />
                )}
              />
            </CardContent>
          </Card>

          {feedbackMessage ? (
            <div className="mb-6 rounded-xl border bg-secondary/50 px-4 py-3 text-sm text-muted-foreground">
              {feedbackMessage}
            </div>
          ) : null}

          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              className="flex-1 rounded-lg"
              disabled={saveSalesMutation.isPending}
              onClick={() => void form.handleSubmit({ mode: 'draft' })}
            >
              <Save className="mr-2 h-4 w-4" />
              保存草稿
            </Button>
            <Button
              type="submit"
              className="flex-1 rounded-lg"
              disabled={saveSalesMutation.isPending}
            >
              <CheckCircle className="mr-2 h-4 w-4" />
              确认提交
            </Button>
          </div>
          </form>
        </div>
      </div>
    </AppShell>
  )
}

type SalesPersistMode = 'draft' | 'submit'

interface SalesFormValues {
  businessDate: string
  bbva: string
  caixa: string
  efectivo: string
  notes: string
}

function createAmountInputs(record: SalesDailyRecord | null) {
  if (!record) {
    return {
      bbva: '',
      caixa: '',
      efectivo: '',
    }
  }

  return {
    bbva: formatAmountInput(record.bbvaAmount),
    caixa: formatAmountInput(record.caixaAmount),
    efectivo: formatAmountInput(record.cashAmount),
  }
}

function createSalesFormValues(
  record: SalesDailyRecord | null,
  businessDate: string,
): SalesFormValues {
  const amounts = createAmountInputs(record)

  return {
    businessDate,
    bbva: amounts.bbva,
    caixa: amounts.caixa,
    efectivo: amounts.efectivo,
    notes: record?.note ?? '',
  }
}

function getSalesTotal(values: SalesFormValues) {
  return [values.bbva, values.caixa, values.efectivo].reduce((sum, value) => {
    const amount = Number.parseFloat(value) || 0
    return sum + amount
  }, 0)
}

function toSalesPayload(values: SalesFormValues): SalesDailyDraftInput {
  return {
    date: values.businessDate,
    amounts: {
      bbva: values.bbva,
      caixa: values.caixa,
      efectivo: values.efectivo,
    },
    notes: values.notes,
  }
}

function isDecimalInput(value: string) {
  return value === '' || /^\d*\.?\d*$/.test(value)
}

function formatAmountInput(value: number) {
  return value === 0 ? '' : value.toFixed(2)
}
