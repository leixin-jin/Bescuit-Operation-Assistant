"use client"

import { useState } from "react"
import {
  ArrowLeft,
  ZoomIn,
  ZoomOut,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  Save,
  CheckCircle,
  AlertCircle,
  Upload,
  FileImage,
} from "lucide-react"
import Link from "next/link"
import { AppShell } from "@/components/app-shell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// Mock data for invoice items
const mockLineItems = [
  { id: 1, name: "Heineken 啤酒 330ml", qty: 24, unit: "瓶", unitPrice: 1.20, matched: true, ingredient: "heineken-330" },
  { id: 2, name: "Absolut Vodka 750ml", qty: 6, unit: "瓶", unitPrice: 12.50, matched: true, ingredient: "absolut-750" },
  { id: 3, name: "柠檬", qty: 5, unit: "kg", unitPrice: 2.80, matched: false, ingredient: null },
  { id: 4, name: "薄荷叶", qty: 2, unit: "盒", unitPrice: 4.50, matched: false, ingredient: null },
  { id: 5, name: "可口可乐 330ml", qty: 48, unit: "罐", unitPrice: 0.45, matched: true, ingredient: "coke-330" },
]

const ingredientOptions = [
  { value: "heineken-330", label: "Heineken 啤酒 330ml" },
  { value: "absolut-750", label: "Absolut Vodka 750ml" },
  { value: "coke-330", label: "可口可乐 330ml" },
  { value: "lemon", label: "柠檬" },
  { value: "mint", label: "薄荷叶" },
  { value: "lime", label: "青柠" },
]

export default function InvoiceReviewPage() {
  const [zoom, setZoom] = useState(100)
  const [currentPage, setCurrentPage] = useState(1)
  const totalPages = 1
  const [lineItems, setLineItems] = useState(mockLineItems)
  const [invoiceHeader, setInvoiceHeader] = useState({
    supplier: "Metro Cash & Carry",
    invoiceNo: "INV-2024-001234",
    date: "2024-01-15",
    totalAmount: "156.30",
  })

  const unmatchedCount = lineItems.filter((item) => !item.matched).length

  const handleIngredientChange = (itemId: number, value: string) => {
    setLineItems((items) =>
      items.map((item) =>
        item.id === itemId
          ? { ...item, ingredient: value, matched: !!value }
          : item
      )
    )
  }

  return (
    <AppShell>
      <div className="flex h-[calc(100vh-3.5rem)] flex-col lg:h-screen">
        {/* Page Header */}
        <div className="shrink-0 border-b bg-background px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/"
                className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                返回
              </Link>
              <div>
                <h1 className="text-xl font-bold">发票核对</h1>
                <p className="text-sm text-muted-foreground">
                  核对发票信息并映射原料
                </p>
              </div>
            </div>
            {unmatchedCount > 0 && (
              <Badge variant="secondary" className="gap-1.5 bg-amber-100 text-amber-700">
                <AlertCircle className="h-3.5 w-3.5" />
                {unmatchedCount} 项未匹配
              </Badge>
            )}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
          {/* Left Panel - Image Preview (60%) */}
          <div className="flex h-1/2 flex-col border-b bg-muted/30 lg:h-full lg:w-[60%] lg:border-b-0 lg:border-r">
            {/* Preview Area */}
            <div className="flex flex-1 items-center justify-center overflow-auto p-6">
              <div
                className="relative flex h-full w-full items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/25 bg-white"
                style={{ transform: `scale(${zoom / 100})` }}
              >
                <div className="text-center">
                  <FileImage className="mx-auto h-16 w-16 text-muted-foreground/50" />
                  <p className="mt-4 text-sm text-muted-foreground">
                    发票预览区域
                  </p>
                  <Button variant="secondary" className="mt-4 rounded-lg">
                    <Upload className="mr-2 h-4 w-4" />
                    上传发票图片
                  </Button>
                </div>
              </div>
            </div>

            {/* Image Controls */}
            <div className="flex shrink-0 items-center justify-between border-t bg-background px-4 py-3">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-lg"
                  onClick={() => setZoom((z) => Math.max(50, z - 10))}
                >
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <span className="min-w-[3rem] text-center text-sm">
                  {zoom}%
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-lg"
                  onClick={() => setZoom((z) => Math.min(200, z + 10))}
                >
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="ml-2 h-8 w-8 rounded-lg"
                >
                  <RotateCw className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-lg"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm">
                  {currentPage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-lg"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Right Panel - Data Form (40%) */}
          <div className="flex h-1/2 flex-col lg:h-full lg:w-[40%]">
            <div className="flex-1 overflow-auto p-6">
              {/* Header Fields */}
              <Card className="mb-6 rounded-xl">
                <CardHeader className="pb-4">
                  <CardTitle className="text-base">发票信息</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="supplier">供应商</Label>
                      <Input
                        id="supplier"
                        value={invoiceHeader.supplier}
                        onChange={(e) =>
                          setInvoiceHeader((h) => ({
                            ...h,
                            supplier: e.target.value,
                          }))
                        }
                        className="rounded-lg"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="invoiceNo">发票号</Label>
                      <Input
                        id="invoiceNo"
                        value={invoiceHeader.invoiceNo}
                        onChange={(e) =>
                          setInvoiceHeader((h) => ({
                            ...h,
                            invoiceNo: e.target.value,
                          }))
                        }
                        className="rounded-lg"
                      />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="date">发票日期</Label>
                      <Input
                        id="date"
                        type="date"
                        value={invoiceHeader.date}
                        onChange={(e) =>
                          setInvoiceHeader((h) => ({
                            ...h,
                            date: e.target.value,
                          }))
                        }
                        className="rounded-lg"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="totalAmount">总金额 (€)</Label>
                      <Input
                        id="totalAmount"
                        value={invoiceHeader.totalAmount}
                        onChange={(e) =>
                          setInvoiceHeader((h) => ({
                            ...h,
                            totalAmount: e.target.value,
                          }))
                        }
                        className="rounded-lg"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Line Items Table */}
              <Card className="mb-6 rounded-xl">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span>行项目</span>
                    <Badge variant="secondary" className="rounded-full">
                      {lineItems.length} 项
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8"></TableHead>
                          <TableHead>品名</TableHead>
                          <TableHead className="text-right">数量</TableHead>
                          <TableHead className="text-right">单价</TableHead>
                          <TableHead>原料映射</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lineItems.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell>
                              <div
                                className={`h-2.5 w-2.5 rounded-full ${
                                  item.matched
                                    ? "bg-emerald-500"
                                    : "bg-amber-500"
                                }`}
                              />
                            </TableCell>
                            <TableCell className="font-medium">
                              {item.name}
                            </TableCell>
                            <TableCell className="text-right">
                              {item.qty} {item.unit}
                            </TableCell>
                            <TableCell className="text-right">
                              €{item.unitPrice.toFixed(2)}
                            </TableCell>
                            <TableCell>
                              <Select
                                value={item.ingredient || ""}
                                onValueChange={(value) =>
                                  handleIngredientChange(item.id, value)
                                }
                              >
                                <SelectTrigger className="h-8 w-32 rounded-lg text-xs">
                                  <SelectValue placeholder="选择原料" />
                                </SelectTrigger>
                                <SelectContent>
                                  {ingredientOptions.map((opt) => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              {/* Mapping Reminder */}
              {unmatchedCount > 0 && (
                <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                    <div>
                      <p className="font-medium text-amber-800">原料映射提醒</p>
                      <p className="mt-1 text-sm text-amber-700">
                        还有 {unmatchedCount} 项商品未映射到原料库，请完成映射后再入账。
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Fixed Action Bar */}
            <div className="shrink-0 border-t bg-background px-6 py-4">
              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1 rounded-lg">
                  <Save className="mr-2 h-4 w-4" />
                  保存草稿
                </Button>
                <Button className="flex-1 rounded-lg" disabled={unmatchedCount > 0}>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  确认入账
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
