import type { IngredientOption } from '@/lib/server/app-domain'
import {
  createStoredInvoiceJob,
  getStoredInvoiceJob,
  getStoredSalesRecord,
  listStoredInvoiceJobs,
  listStoredSalesRecords,
  upsertStoredInvoiceJob,
  upsertStoredSalesRecord,
} from '@/lib/server/fallback-store'

export const demoIngredientOptions: IngredientOption[] = [
  { value: 'heineken-330', label: 'Heineken 啤酒 330ml' },
  { value: 'absolut-750', label: 'Absolut Vodka 750ml' },
  { value: 'coke-330', label: '可口可乐 330ml' },
  { value: 'lemon', label: '柠檬' },
  { value: 'mint', label: '薄荷叶' },
  { value: 'lime', label: '青柠' },
]

export {
  createStoredInvoiceJob,
  getStoredInvoiceJob,
  getStoredSalesRecord,
  listStoredInvoiceJobs,
  listStoredSalesRecords,
  upsertStoredInvoiceJob,
  upsertStoredSalesRecord,
}
