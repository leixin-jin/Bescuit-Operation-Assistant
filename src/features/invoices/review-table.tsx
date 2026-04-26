import { useMemo } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
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
  disabled?: boolean
  onQuantityChange: (itemId: string, value: string) => void
  onUnitPriceChange: (itemId: string, value: string) => void
  onIngredientChange: (itemId: string, value: string) => void
}

export function ReviewTable({
  lineItems,
  ingredientOptions,
  disabled = false,
  onQuantityChange,
  onUnitPriceChange,
  onIngredientChange,
}: ReviewTableProps) {
  const unmatchedCount = lineItems.filter((item) => !item.matched).length
  const columns = useMemo(() => {
    const columnHelper = createColumnHelper<InvoiceLineItemDraft>()

    return [
      columnHelper.display({
        id: 'status',
        header: '',
        cell: ({ row }) => (
          <div
            className={`h-2.5 w-2.5 rounded-full ${
              row.original.matched ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
          />
        ),
      }),
      columnHelper.accessor('name', {
        header: '品名',
        cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
      }),
      columnHelper.display({
        id: 'quantity',
        header: () => <span className="block text-right">数量</span>,
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-2">
            <Input
              disabled={disabled}
              value={row.original.qty}
              onChange={(event) => onQuantityChange(row.original.id, event.target.value)}
              className="h-8 w-20 rounded-lg text-right"
            />
            <span className="text-xs text-muted-foreground">{row.original.unit}</span>
          </div>
        ),
      }),
      columnHelper.display({
        id: 'unitPrice',
        header: () => <span className="block text-right">单价</span>,
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs text-muted-foreground">€</span>
            <Input
              disabled={disabled}
              value={row.original.unitPrice}
              onChange={(event) => onUnitPriceChange(row.original.id, event.target.value)}
              className="h-8 w-24 rounded-lg text-right"
            />
          </div>
        ),
      }),
      columnHelper.display({
        id: 'lineTotal',
        header: () => <span className="block text-right">小计</span>,
        cell: ({ row }) => {
          const lineTotal =
            (Number.parseFloat(row.original.qty) || 0) *
            (Number.parseFloat(row.original.unitPrice) || 0)

          return (
            <span className="block text-right font-medium">
              €{lineTotal.toFixed(2)}
            </span>
          )
        },
      }),
      columnHelper.display({
        id: 'ingredient',
        header: '原料映射',
        cell: ({ row }) => (
          <Select
            disabled={disabled}
            value={row.original.ingredient}
            onValueChange={(value) => onIngredientChange(row.original.id, value)}
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
        ),
      }),
    ]
  }, [
    disabled,
    ingredientOptions,
    onIngredientChange,
    onQuantityChange,
    onUnitPriceChange,
  ])
  const table = useReactTable({
    data: lineItems,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

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
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id} className={getColumnClassName(header.column.id)}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
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

function getColumnClassName(columnId: string) {
  switch (columnId) {
    case 'status':
      return 'w-10'
    case 'name':
      return 'min-w-44'
    case 'quantity':
      return 'min-w-24 text-right'
    case 'unitPrice':
    case 'lineTotal':
      return 'min-w-28 text-right'
    case 'ingredient':
      return 'min-w-52'
    default:
      return undefined
  }
}
