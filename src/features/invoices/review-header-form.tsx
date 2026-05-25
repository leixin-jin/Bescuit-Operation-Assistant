import { RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { InvoiceHeaderDraft } from '@/lib/server/app-domain'

interface ReviewHeaderFormProps {
  header: InvoiceHeaderDraft
  disabled?: boolean
  recheckDisabled?: boolean
  recheckPending?: boolean
  onRecheck?: () => void
  onFieldChange: (field: keyof InvoiceHeaderDraft, value: string) => void
}

export function ReviewHeaderForm({
  header,
  disabled = false,
  recheckDisabled = false,
  recheckPending = false,
  onRecheck,
  onFieldChange,
}: ReviewHeaderFormProps) {
  return (
    <Card className="rounded-xl">
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-4">
        <CardTitle className="text-base">发票信息</CardTitle>
        {onRecheck ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-lg"
            disabled={recheckDisabled}
            onClick={onRecheck}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${recheckPending ? 'animate-spin' : ''}`}
            />
            {recheckPending ? '重新核对中' : '重新核对'}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="supplier">供应商</Label>
            <Input
              id="supplier"
              disabled={disabled}
              value={header.supplier}
              onChange={(event) => onFieldChange('supplier', event.target.value)}
              className="rounded-lg"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invoiceNo">发票号</Label>
            <Input
              id="invoiceNo"
              disabled={disabled}
              value={header.invoiceNo}
              onChange={(event) => onFieldChange('invoiceNo', event.target.value)}
              className="rounded-lg"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="date">发票日期</Label>
            <Input
              id="date"
              type="date"
              disabled={disabled}
              value={header.date}
              onChange={(event) => onFieldChange('date', event.target.value)}
              className="rounded-lg"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="totalAmount">总金额 (€)</Label>
            <Input
              id="totalAmount"
              disabled={disabled}
              value={header.totalAmount}
              inputMode="decimal"
              onChange={(event) => onFieldChange('totalAmount', event.target.value)}
              className="rounded-lg"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="taxAmount">税额 (€)</Label>
            <Input
              id="taxAmount"
              disabled={disabled}
              value={header.taxAmount}
              inputMode="decimal"
              onChange={(event) => onFieldChange('taxAmount', event.target.value)}
              className="rounded-lg"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes">备注</Label>
          <Textarea
            id="notes"
            disabled={disabled}
            value={header.notes}
            onChange={(event) => onFieldChange('notes', event.target.value)}
            className="min-h-24 resize-none rounded-lg"
          />
        </div>
      </CardContent>
    </Card>
  )
}
