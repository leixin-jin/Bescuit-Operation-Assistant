import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { InvoiceHeaderDraft } from '@/lib/server/app-domain'

interface ReviewHeaderFormProps {
  header: InvoiceHeaderDraft
  onFieldChange: (field: keyof InvoiceHeaderDraft, value: string) => void
}

export function ReviewHeaderForm({
  header,
  onFieldChange,
}: ReviewHeaderFormProps) {
  return (
    <Card className="rounded-xl">
      <CardHeader className="pb-4">
        <CardTitle className="text-base">发票信息</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="supplier">供应商</Label>
            <Input
              id="supplier"
              value={header.supplier}
              onChange={(event) => onFieldChange('supplier', event.target.value)}
              className="rounded-lg"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invoiceNo">发票号</Label>
            <Input
              id="invoiceNo"
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
              value={header.date}
              onChange={(event) => onFieldChange('date', event.target.value)}
              className="rounded-lg"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="totalAmount">总金额 (€)</Label>
            <Input
              id="totalAmount"
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
            value={header.notes}
            onChange={(event) => onFieldChange('notes', event.target.value)}
            className="min-h-24 resize-none rounded-lg"
          />
        </div>
      </CardContent>
    </Card>
  )
}
