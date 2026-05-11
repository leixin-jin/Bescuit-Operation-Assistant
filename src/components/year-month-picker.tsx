import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  formatMonthKey,
  getMonthKeyParts,
  getMonthNumberOptions,
  getYearOptions,
  type YearRange,
} from '@/lib/month-selection'

interface YearMonthPickerProps {
  value: string
  onChange: (monthKey: string) => void
  yearLabel: string
  monthLabel: string
  yearRange?: YearRange
}

export function YearMonthPicker({
  value,
  onChange,
  yearLabel,
  monthLabel,
  yearRange,
}: YearMonthPickerProps) {
  const { year, month } = getMonthKeyParts(value)
  const years = getYearOptions(value, yearRange?.before, yearRange?.after)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={year.toString()}
        onValueChange={(nextYear) => onChange(formatMonthKey(Number.parseInt(nextYear, 10), month))}
      >
        <SelectTrigger aria-label={yearLabel} className="h-9 w-28 rounded-lg">
          <SelectValue placeholder="选择年份" />
        </SelectTrigger>
        <SelectContent>
          {years.map((optionYear) => (
            <SelectItem key={optionYear} value={optionYear.toString()}>
              {optionYear}年
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={month.toString()}
        onValueChange={(nextMonth) => onChange(formatMonthKey(year, Number.parseInt(nextMonth, 10)))}
      >
        <SelectTrigger aria-label={monthLabel} className="h-9 w-24 rounded-lg">
          <SelectValue placeholder="选择月份" />
        </SelectTrigger>
        <SelectContent>
          {getMonthNumberOptions().map((optionMonth) => (
            <SelectItem key={optionMonth} value={optionMonth.toString()}>
              {optionMonth}月
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
