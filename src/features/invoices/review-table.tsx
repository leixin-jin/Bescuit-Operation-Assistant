import { useMemo } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { InvoiceLineItemDraft } from '@/lib/server/app-domain'

interface ReviewTableProps {
  lineItems: InvoiceLineItemDraft[]
  disabled?: boolean
  onQuantityChange: (itemId: string, value: string) => void
  onUnitPriceChange: (itemId: string, value: string) => void
}

export function ReviewTable({
  lineItems,
  disabled = false,
  onQuantityChange,
  onUnitPriceChange,
}: ReviewTableProps) {
  const columns = useMemo(() => {
    const columnHelper = createColumnHelper<InvoiceLineItemDraft>()

    return [
      columnHelper.accessor('name', {
        header: '品名',
        cell: ({ row, getValue }) => (
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{getValue()}</span>
              {typeof row.original.confidence === 'number' ? (
                <Badge variant="outline" className="rounded-lg text-[11px]">
                  {Math.round(row.original.confidence * 100)}%
                </Badge>
              ) : null}
            </div>
            {row.original.sourceText ? (
              <p className="mt-1 max-w-64 truncate text-xs text-muted-foreground">
                {row.original.sourceText}
              </p>
            ) : null}
          </div>
        ),
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
          const parsedLineTotal =
            row.original.lineTotal && Number.isFinite(Number.parseFloat(row.original.lineTotal))
              ? Number.parseFloat(row.original.lineTotal)
              : (Number.parseFloat(row.original.qty) || 0) *
                (Number.parseFloat(row.original.unitPrice) || 0)
          const lineTotal = Number.isFinite(parsedLineTotal) ? parsedLineTotal : 0

          return (
            <span className="block text-right font-medium">
              €{lineTotal.toFixed(2)}
            </span>
          )
        },
      }),
      columnHelper.display({
        id: 'taxRate',
        header: () => <span className="block text-right">IVA</span>,
        cell: ({ row }) => (
          <span className="block text-right text-sm">
            {row.original.taxRate?.trim() || '-'}
          </span>
        ),
      }),
      columnHelper.display({
        id: 'notes',
        header: '其他',
        cell: ({ row }) =>
          row.original.notes ? (
            <span className="text-sm text-muted-foreground">{row.original.notes}</span>
          ) : (
            <span className="text-sm text-muted-foreground">-</span>
          ),
      }),
    ]
  }, [disabled, onQuantityChange, onUnitPriceChange])
  const table = useReactTable({
    data: lineItems,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
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
  )
}

function getColumnClassName(columnId: string) {
  switch (columnId) {
    case 'name':
      return 'min-w-44'
    case 'quantity':
      return 'min-w-24 text-right'
    case 'unitPrice':
    case 'lineTotal':
    case 'taxRate':
      return 'min-w-28 text-right'
    case 'notes':
      return 'min-w-52'
    default:
      return undefined
  }
}
