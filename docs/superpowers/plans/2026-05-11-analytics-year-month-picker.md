# Analytics Year Month Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users choose a specific year and month on both `数据分析` and `日历概览`, instead of being limited to the current three-month dropdown or previous/next navigation.

**Architecture:** Keep the existing server query contract unchanged: both analytics routes continue passing a `YYYY-MM` month string into the server functions. Add a small shared client-side month helper module and a reusable `YearMonthPicker` component, then wire it into both analytics pages. Preserve the calendar page's previous, next, and today controls.

**Tech Stack:** React 19, TanStack Router, TanStack Query, Radix/shadcn `Select`, Vitest, Testing Library.

---

## File Structure

- Create: `src/lib/month-selection.ts`
  - Pure client-safe helpers for validating, formatting, and shifting month keys.
  - Exports reusable year/month option generation so UI and tests do not duplicate date math.
- Create: `src/components/year-month-picker.tsx`
  - Shared controlled component with two selects: one for year, one for month.
  - Accepts `value: string`, `onChange: (month: string) => void`, and optional `yearRange`.
- Create: `src/tests/month-selection.test.ts`
  - Unit tests for month key formatting, validation, year option generation, and month shifting across year boundaries.
- Modify: `src/routes/analytics/monthly.tsx`
  - Replace the existing single month dropdown with `YearMonthPicker`.
  - Stop importing `Select` and `getMonthOptions` for the page UI.
  - Keep the existing TanStack Query `queryKey` and server call behavior.
- Modify: `src/routes/analytics/calendar.tsx`
  - Add `YearMonthPicker` to the calendar card header.
  - Replace local `shiftMonth` and `toMonthDate` with shared helpers where practical.
  - Keep previous/next/today buttons as shortcut controls.
- Modify: `src/tests/router.smoke.test.tsx`
  - Add route-level smoke coverage proving both pages expose year and month selectors and update visible state after user selection.

---

### Task 1: Add Month Selection Helpers

**Files:**
- Create: `src/lib/month-selection.ts`
- Test: `src/tests/month-selection.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `src/tests/month-selection.test.ts`:

```ts
import { describe, expect, test } from 'vitest'

import {
  formatMonthKey,
  getMonthNumberOptions,
  getYearOptions,
  isValidMonthKey,
  shiftMonthKey,
  toMonthDate,
} from '@/lib/month-selection'

describe('month selection helpers', () => {
  test('formats month keys with a padded month', () => {
    expect(formatMonthKey(2026, 4)).toBe('2026-04')
    expect(formatMonthKey(2026, 12)).toBe('2026-12')
  })

  test('validates YYYY-MM month keys', () => {
    expect(isValidMonthKey('2026-04')).toBe(true)
    expect(isValidMonthKey('2026-4')).toBe(false)
    expect(isValidMonthKey('2026-13')).toBe(false)
    expect(isValidMonthKey('abcd-04')).toBe(false)
  })

  test('builds a stable year range around the selected year', () => {
    expect(getYearOptions('2026-04', 2, 1)).toEqual([2024, 2025, 2026, 2027])
  })

  test('returns all calendar month numbers', () => {
    expect(getMonthNumberOptions()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  test('shifts month keys across year boundaries', () => {
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12')
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01')
  })

  test('creates a noon local date for the first day of the selected month', () => {
    const date = toMonthDate('2026-04')

    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(3)
    expect(date.getDate()).toBe(1)
    expect(date.getHours()).toBe(12)
  })
})
```

- [ ] **Step 2: Run helper test and verify it fails**

Run:

```bash
pnpm vitest run src/tests/month-selection.test.ts
```

Expected: FAIL because `src/lib/month-selection.ts` does not exist yet.

- [ ] **Step 3: Implement the shared helper module**

Create `src/lib/month-selection.ts`:

```ts
export interface YearRange {
  before?: number
  after?: number
}

export function formatMonthKey(year: number, month: number) {
  return [year.toString(), String(month).padStart(2, '0')].join('-')
}

export function isValidMonthKey(monthKey: string) {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    return false
  }

  const [, monthText] = monthKey.split('-')
  const month = Number.parseInt(monthText, 10)
  return month >= 1 && month <= 12
}

export function getMonthKeyParts(monthKey: string) {
  const fallbackMonthKey = new Date().toISOString().slice(0, 7)
  const safeMonthKey = isValidMonthKey(monthKey) ? monthKey : fallbackMonthKey
  const [yearText, monthText] = safeMonthKey.split('-')

  return {
    year: Number.parseInt(yearText, 10),
    month: Number.parseInt(monthText, 10),
  }
}

export function getYearOptions(
  selectedMonth: string,
  before = 5,
  after = 1,
) {
  const { year } = getMonthKeyParts(selectedMonth)
  const startYear = year - before
  const endYear = year + after
  const years: number[] = []

  for (let currentYear = startYear; currentYear <= endYear; currentYear += 1) {
    years.push(currentYear)
  }

  return years
}

export function getMonthNumberOptions() {
  return Array.from({ length: 12 }, (_, index) => index + 1)
}

export function shiftMonthKey(monthKey: string, offset: number) {
  const date = toMonthDate(monthKey)
  date.setMonth(date.getMonth() + offset)
  return formatMonthKey(date.getFullYear(), date.getMonth() + 1)
}

export function toMonthDate(monthKey: string) {
  const { year, month } = getMonthKeyParts(monthKey)
  return new Date(year, month - 1, 1, 12)
}
```

- [ ] **Step 4: Run helper test and verify it passes**

Run:

```bash
pnpm vitest run src/tests/month-selection.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit helper module**

```bash
git add src/lib/month-selection.ts src/tests/month-selection.test.ts
git commit -m "feat: add month selection helpers"
```

---

### Task 2: Create Shared Year Month Picker

**Files:**
- Create: `src/components/year-month-picker.tsx`
- Modify: `src/tests/router.smoke.test.tsx`

- [ ] **Step 1: Add failing smoke assertions for both analytics pages**

In `src/tests/router.smoke.test.tsx`, extend the existing imports:

```ts
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
```

Add these tests inside `describe('phase 1-4 smoke tests', () => { ... })`:

```tsx
  test('monthly analytics exposes separate year and month selectors', async () => {
    await renderRoute('/analytics/monthly')

    expect(await screen.findByRole('heading', { name: '数据分析' })).toBeTruthy()
    expect(screen.getByLabelText('分析年份')).toBeTruthy()
    expect(screen.getByLabelText('分析月份')).toBeTruthy()
  })

  test('calendar analytics exposes separate year and month selectors', async () => {
    await renderRoute('/analytics/calendar')

    expect(await screen.findByRole('heading', { name: '日历概览' })).toBeTruthy()
    expect(screen.getByLabelText('日历年份')).toBeTruthy()
    expect(screen.getByLabelText('日历月份')).toBeTruthy()
  })
```

- [ ] **Step 2: Run route smoke tests and verify the new assertions fail**

Run:

```bash
pnpm vitest run src/tests/router.smoke.test.tsx
```

Expected: FAIL because the labels `分析年份`, `分析月份`, `日历年份`, and `日历月份` are not rendered yet.

- [ ] **Step 3: Create `YearMonthPicker`**

Create `src/components/year-month-picker.tsx`:

```tsx
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
```

- [ ] **Step 4: Run type check for the new component surface**

Run:

```bash
pnpm exec tsc --noEmit
```

Expected: PASS. The new component and helper imports should type-check before the routes use them.

- [ ] **Step 5: Commit shared component after route wiring in later tasks**

Do not commit this file by itself yet. It will be committed with the first page integration that proves it renders correctly.

---

### Task 3: Wire Picker Into `数据分析`

**Files:**
- Modify: `src/routes/analytics/monthly.tsx`
- Test: `src/tests/router.smoke.test.tsx`

- [ ] **Step 1: Update imports in `src/routes/analytics/monthly.tsx`**

Remove the `Select` import block and remove `getMonthOptions` from the app-domain import. Add:

```tsx
import { YearMonthPicker } from '@/components/year-month-picker'
```

The app-domain import should become:

```tsx
import {
  getMadridTodayInputValue,
  type MonthlyAnalyticsSummary,
} from '@/lib/server/app-domain'
```

- [ ] **Step 2: Replace the current month dropdown**

Replace the existing `<Select value={selectedMonth} onValueChange={setSelectedMonth}>...</Select>` block in the page header with:

```tsx
          <YearMonthPicker
            value={selectedMonth}
            onChange={setSelectedMonth}
            yearLabel="分析年份"
            monthLabel="分析月份"
          />
```

- [ ] **Step 3: Make the fallback independent from three-month options**

In `createMonthlySummaryFallback`, replace:

```ts
    monthOptions: getMonthOptions(selectedMonth),
```

with:

```ts
    monthOptions: [],
```

This keeps the existing `MonthlyAnalyticsSummary` type stable while making the UI independent from server-provided limited month options.

- [ ] **Step 4: Run the monthly smoke assertion**

Run:

```bash
pnpm vitest run src/tests/router.smoke.test.tsx -t "monthly analytics exposes separate year and month selectors"
```

Expected: PASS.

- [ ] **Step 5: Commit the shared picker and monthly page integration**

```bash
git add src/components/year-month-picker.tsx src/routes/analytics/monthly.tsx src/tests/router.smoke.test.tsx
git commit -m "feat: add year month picker to analytics page"
```

---

### Task 4: Wire Picker Into `日历概览`

**Files:**
- Modify: `src/routes/analytics/calendar.tsx`
- Test: `src/tests/router.smoke.test.tsx`

- [ ] **Step 1: Update imports in `src/routes/analytics/calendar.tsx`**

Add:

```tsx
import { YearMonthPicker } from '@/components/year-month-picker'
import { shiftMonthKey, toMonthDate } from '@/lib/month-selection'
```

- [ ] **Step 2: Replace local date helper usage**

Delete the local `shiftMonth` and `toMonthDate` functions at the bottom of the file.

Replace previous and next button handlers:

```tsx
onClick={() => setSelectedMonth(shiftMonth(selectedMonth, -1))}
```

with:

```tsx
onClick={() => setSelectedMonth(shiftMonthKey(selectedMonth, -1))}
```

and:

```tsx
onClick={() => setSelectedMonth(shiftMonth(selectedMonth, 1))}
```

with:

```tsx
onClick={() => setSelectedMonth(shiftMonthKey(selectedMonth, 1))}
```

- [ ] **Step 3: Add the year/month picker to the calendar header**

Replace the card header title/control layout:

```tsx
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <CardTitle className="text-base">{calendarSummary.monthName}</CardTitle>
            <div className="flex items-center gap-2">
```

with:

```tsx
          <CardHeader className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <CardTitle className="text-base">{calendarSummary.monthName}</CardTitle>
              <YearMonthPicker
                value={selectedMonth}
                onChange={setSelectedMonth}
                yearLabel="日历年份"
                monthLabel="日历月份"
              />
            </div>
            <div className="flex items-center gap-2">
```

- [ ] **Step 4: Run the calendar smoke assertion**

Run:

```bash
pnpm vitest run src/tests/router.smoke.test.tsx -t "calendar analytics exposes separate year and month selectors"
```

Expected: PASS.

- [ ] **Step 5: Commit calendar page integration**

```bash
git add src/routes/analytics/calendar.tsx src/tests/router.smoke.test.tsx
git commit -m "feat: add year month picker to calendar page"
```

---

### Task 5: Add Interaction Coverage

**Files:**
- Modify: `src/tests/router.smoke.test.tsx`

- [ ] **Step 1: Add a route smoke test for selecting a different calendar month**

Add this test inside `describe('phase 1-4 smoke tests', () => { ... })`:

```tsx
  test('calendar month selector updates the visible month title', async () => {
    await renderRoute('/analytics/calendar')

    const monthTrigger = await screen.findByLabelText('日历月份')

    fireEvent.pointerDown(monthTrigger)
    const listbox = await screen.findByRole('listbox')
    fireEvent.click(within(listbox).getByRole('option', { name: '4月' }))

    await waitFor(() => {
      expect(screen.getByText(/4月/)).toBeTruthy()
    })
  })
```

- [ ] **Step 2: Add a route smoke test for selecting a different analytics month**

Add:

```tsx
  test('monthly analytics month selector can select a specific month', async () => {
    await renderRoute('/analytics/monthly')

    const monthTrigger = await screen.findByLabelText('分析月份')

    fireEvent.pointerDown(monthTrigger)
    const listbox = await screen.findByRole('listbox')
    fireEvent.click(within(listbox).getByRole('option', { name: '4月' }))

    await waitFor(() => {
      expect(screen.getByLabelText('分析月份')).toHaveTextContent('4月')
    })
  })
```

- [ ] **Step 3: Ensure the matcher is available**

If `toHaveTextContent` is not globally available in the current Vitest setup, replace the final assertion with:

```tsx
      expect(screen.getByLabelText('分析月份').textContent).toContain('4月')
```

- [ ] **Step 4: Run the interaction tests**

Run:

```bash
pnpm vitest run src/tests/router.smoke.test.tsx -t "month selector"
```

Expected: PASS for both selector interaction tests.

- [ ] **Step 5: Commit interaction coverage**

```bash
git add src/tests/router.smoke.test.tsx
git commit -m "test: cover analytics month selector interactions"
```

---

### Task 6: Final Verification

**Files:**
- No source file changes expected unless verification reveals a defect.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm vitest run src/tests/month-selection.test.ts src/tests/router.smoke.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript check**

Run:

```bash
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Run production build**

Run:

```bash
pnpm run build
```

Expected: PASS.

- [ ] **Step 5: Manual browser check**

Run:

```bash
pnpm run dev
```

Open:

```text
http://localhost:3000/analytics/monthly
http://localhost:3000/analytics/calendar
```

Verify:

- `数据分析` shows separate year and month selectors.
- `数据分析` can select a non-recent month, for example `2026年` + `4月`.
- `日历概览` shows separate year and month selectors.
- `日历概览` month title and calendar grid update after changing year or month.
- Calendar previous, next, and today buttons still work.
- Mobile width keeps the selectors and shortcut buttons readable without overlap.

- [ ] **Step 6: Commit any verification fixes**

If verification required a fix, commit the exact changed files:

```bash
git add src/lib/month-selection.ts src/components/year-month-picker.tsx src/routes/analytics/monthly.tsx src/routes/analytics/calendar.tsx src/tests/month-selection.test.ts src/tests/router.smoke.test.tsx
git commit -m "fix: polish analytics month selection"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

**Spec coverage:** The plan covers both requested pages: `数据分析` and `日历概览`. Both get user-selectable year and month controls, and both continue querying analytics by `YYYY-MM`.

**Placeholder scan:** No task depends on undefined later work. All new files, imports, core code blocks, commands, and expected outcomes are specified.

**Type consistency:** The shared value remains `string` in `YYYY-MM` format. The picker uses `value` and `onChange`, matching existing route state patterns. The server query functions are unchanged.
