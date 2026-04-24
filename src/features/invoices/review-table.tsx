import { AlertCircle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type {
  IngredientOption,
  InvoiceLineItemDraft,
} from '@/lib/server/app-domain'

interface ReviewTableProps {
  lineItems: InvoiceLineItemDraft[]
  ingredientOptions: IngredientOption[]
  onQuantityChange: (itemId: string, value: string) => void
  onUnitPriceChange: (itemId: string, value: string) => void
  onIngredientChange: (itemId: string, value: string) => void
}

export function ReviewTable({
  lineItems,
  ingredientOptions,
  onQuantityChange,
  onUnitPriceChange,
  onIngredientChange,
}: ReviewTableProps) {
  const unmatchedCount = lineItems.filter((item) => !item.matched).length

  return (
    <>
      <Card className="rounded-xl">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center justify-between text-base">
            <span>行项目</span>
            <Badge variant="secondary" className="rounded-full">
              {lineItems.length} 项
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead className="min-w-44">品名</TableHead>
                  <TableHead className="min-w-24 text-right">数量</TableHead>
                  <TableHead className="min-w-28 text-right">单价</TableHead>
                  <TableHead className="min-w-28 text-right">小计</TableHead>
                  <TableHead className="min-w-52">原料映射</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lineItems.map((item) => {
                  const lineTotal =
                    (Number.parseFloat(item.qty) || 0) *
                    (Number.parseFloat(item.unitPrice) || 0)

                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div
                          className={`h-2.5 w-2.5 rounded-full ${
                            item.matched ? 'bg-emerald-500' : 'bg-amber-500'
                          }`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <Input
                            value={item.qty}
                            onChange={(event) =>
                              onQuantityChange(item.id, event.target.value)
                            }
                            className="h-8 w-20 rounded-lg text-right"
                          />
                          <span className="text-xs text-muted-foreground">{item.unit}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-muted-foreground">€</span>
                          <Input
                            value={item.unitPrice}
                            onChange={(event) =>
                              onUnitPriceChange(item.id, event.target.value)
                            }
                            className="h-8 w-24 rounded-lg text-right"
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        €{lineTotal.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={item.ingredient}
                          onValueChange={(value) => onIngredientChange(item.id, value)}
                        >
                          <SelectTrigger className="h-8 w-full rounded-lg text-xs">
                            <SelectValue placeholder="选择原料" />
                          </SelectTrigger>
                          <SelectContent>
                            {ingredientOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {unmatchedCount > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="font-medium text-amber-800">原料映射提醒</p>
              <p className="mt-1 text-sm text-amber-700">
                还有 {unmatchedCount} 项商品未映射到原料库，请完成映射后再执行确认入账。
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          当前行项目已全部完成映射，可以进入后续入账流程。
        </div>
      )}
    </>
  )
}
