import { useEffect, useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import {
  ArrowLeft,
  CalendarIcon,
  CheckCircle,
  Euro,
  ReceiptText,
} from 'lucide-react'

import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  getMadridTodayInputValue,
  type ExpenseEntryPageData,
  type ManualExpenseDraftInput,
  type ManualExpenseRecord,
} from '@/lib/server/app-domain'
import { createManualExpenseServerFn } from '@/lib/server/mutations/expenses'
import { getExpenseEntryPageDataServerFn } from '@/lib/server/queries/expenses'

export const Route = createFileRoute('/expenses/new')({
  loader: () => getExpenseEntryPageDataServerFn({ data: {} }),
  component: ExpenseEntryPage,
})

function ExpenseEntryPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const loaderData = Route.useLoaderData() ?? createExpenseEntryPageFallbackData()
  const [businessDate, setBusinessDate] = useState(loaderData.date)
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)

  const expenseEntryQuery = useQuery({
    queryKey: ['expense-entry', businessDate],
    queryFn: async () =>
      (await getExpenseEntryPageDataServerFn({ data: { date: businessDate } })) ??
      createExpenseEntryPageFallbackData(businessDate),
    initialData: businessDate === loaderData.date ? loaderData : undefined,
  })
  const expenseEntryData = expenseEntryQuery.data ?? loaderData

  const createExpenseMutation = useMutation({
    mutationFn: async (value: ExpenseFormValues) =>
      createManualExpenseServerFn({ data: toExpensePayload(value) }),
    onSuccess: async (createdExpense) => {
      form.reset(createExpenseFormValues(createdExpense.entryDate))
      setBusinessDate(createdExpense.entryDate)
      setFeedbackMessage('支出已提交。')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['expense-entry'] }),
        queryClient.invalidateQueries({ queryKey: ['monthly-analytics'] }),
        queryClient.invalidateQueries({ queryKey: ['calendar-analytics'] }),
        router.invalidate(),
      ])
    },
    onError: () => {
      setFeedbackMessage('支出提交失败，请稍后重试。')
    },
  })

  const form = useForm({
    defaultValues: createExpenseFormValues(expenseEntryData.date),
    onSubmit: async ({ value }) => {
      if (!isExpenseFormSubmittable(value)) {
        setFeedbackMessage('日期、供应商不能为空，价格必须大于 0。')
        return
      }

      try {
        await createExpenseMutation.mutateAsync(value)
      } catch {
        // React Query handles mutation errors through onError; keep form submission contained.
      }
    },
  })

  useEffect(() => {
    form.reset(createExpenseFormValues(expenseEntryData.date))
    setFeedbackMessage(null)
  }, [form, expenseEntryData.date])

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
          <h1 className="text-2xl font-bold">支出录入</h1>
          <p className="mt-1 text-muted-foreground">录入某天的供应商支出</p>
        </div>

        <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void form.handleSubmit()
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
                      aria-label="选择日期"
                      type="date"
                      required
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
                <CardTitle className="flex items-center gap-2 text-base">
                  <ReceiptText className="h-4 w-4" />
                  支出信息
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="supplierName">供应商</Label>
                  <form.Field
                    name="supplierName"
                    children={(field) => (
                      <>
                        <Input
                          id="supplierName"
                          list="expense-supplier-options"
                          placeholder="选择或输入供应商"
                          value={field.state.value}
                          onChange={(event) => field.handleChange(event.target.value)}
                          className="rounded-lg"
                        />
                        <datalist id="expense-supplier-options">
                          {expenseEntryData.supplierOptions.map((supplierName) => (
                            <option key={supplierName} value={supplierName} />
                          ))}
                        </datalist>
                      </>
                    )}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="amount">价格</Label>
                  <div className="relative">
                    <Euro className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <form.Field
                      name="amount"
                      children={(field) => (
                        <Input
                          id="amount"
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

                <div className="space-y-2">
                  <Label htmlFor="note">备注（可选）</Label>
                  <form.Field
                    name="note"
                    children={(field) => (
                      <Textarea
                        id="note"
                        aria-label="备注（可选）"
                        placeholder="添加备注信息..."
                        value={field.state.value}
                        onChange={(event) => field.handleChange(event.target.value)}
                        className="min-h-[100px] resize-none rounded-lg"
                      />
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            {feedbackMessage ? (
              <div className="mb-6 rounded-xl border bg-secondary/50 px-4 py-3 text-sm text-muted-foreground">
                {feedbackMessage}
              </div>
            ) : null}

            <form.Subscribe
              selector={(state) => isExpenseFormSubmittable(state.values)}
              children={(canSubmitExpense) => (
                <Button
                  type="submit"
                  className="w-full rounded-lg"
                  disabled={createExpenseMutation.isPending || !canSubmitExpense}
                >
                  <CheckCircle className="mr-2 h-4 w-4" />
                  确认提交
                </Button>
              )}
            />
          </form>

          <RecentExpenses expenses={expenseEntryData.recentExpenses} />
        </div>
      </div>
    </AppShell>
  )
}

function RecentExpenses({ expenses }: { expenses: ManualExpenseRecord[] }) {
  return (
    <Card className="h-fit rounded-xl">
      <CardHeader>
        <CardTitle className="text-base">最近支出</CardTitle>
      </CardHeader>
      <CardContent>
        {expenses.length > 0 ? (
          <div className="space-y-3">
            {expenses.map((expense) => (
              <div
                key={expense.id}
                className="rounded-lg border px-3 py-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{expense.vendor}</p>
                    {expense.note ? (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {expense.note}
                      </p>
                    ) : null}
                  </div>
                  <p className="shrink-0 font-semibold">
                    €{expense.amount.toFixed(2)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">该日期暂无手动支出。</p>
        )}
      </CardContent>
    </Card>
  )
}

function createExpenseEntryPageFallbackData(
  date = getMadridTodayInputValue(),
): ExpenseEntryPageData {
  return {
    date,
    supplierOptions: [],
    recentExpenses: [],
  }
}

interface ExpenseFormValues {
  businessDate: string
  supplierName: string
  amount: string
  note: string
}

function createExpenseFormValues(businessDate: string): ExpenseFormValues {
  return {
    businessDate,
    supplierName: '',
    amount: '',
    note: '',
  }
}

function toExpensePayload(values: ExpenseFormValues): ManualExpenseDraftInput {
  return {
    date: values.businessDate,
    supplierName: values.supplierName,
    amount: values.amount,
    note: values.note,
  }
}

function isExpenseFormSubmittable(values: ExpenseFormValues) {
  return (
    isValidDateInputValue(values.businessDate) &&
    values.supplierName.trim().length > 0 &&
    isCompleteDecimalAmount(values.amount) &&
    Number.parseFloat(values.amount) > 0
  )
}

function isValidDateInputValue(value: string) {
  const trimmedValue = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedValue)) {
    return false
  }

  const date = new Date(`${trimmedValue}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === trimmedValue
}

function isCompleteDecimalAmount(value: string) {
  return /^\d+(?:\.\d+)?$/.test(value.trim())
}

function isDecimalInput(value: string) {
  return value === '' || /^\d*\.?\d*$/.test(value)
}
