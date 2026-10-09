/** Day boundaries, phases, and the date formatting helpers shared across the app.
 *
 * A journal day runs 5:00am to 5:00am: anything written at 1am belongs to the
 * day that just ended, not the calendar date on the clock. Evening starts at
 * 6:00pm, which is when the app switches from planning to reflecting.
 */

export const DAY_START_HOUR = 5
export const EVENING_START_HOUR = 18
export const DARK_MODE_START_HOUR = 20
export const DARK_MODE_END_HOUR = 5

export type DayPhase = 'day' | 'evening'

function pad(value: number) {
  return String(value).padStart(2, '0')
}

export function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** `?hour=21` pins the clock to that hour so every phase can be checked on demand. */
function debugHour(): number | null {
  if (typeof window === 'undefined') return null
  const raw = new URLSearchParams(window.location.search).get('hour')
  if (raw === null) return null
  const hour = Number(raw)
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null
}

export function currentTime(base: Date = new Date()): Date {
  const hour = debugHour()
  if (hour === null) return base
  const shifted = new Date(base)
  shifted.setHours(hour, shifted.getMinutes(), 0, 0)
  return shifted
}

/** The journal day (YYYY-MM-DD) an instant belongs to. */
export function journalDay(at: Date = currentTime()): string {
  const shifted = new Date(at)
  if (shifted.getHours() < DAY_START_HOUR) shifted.setDate(shifted.getDate() - 1)
  return toIsoDate(shifted)
}

export function dayPhase(at: Date = currentTime()): DayPhase {
  const hour = at.getHours()
  return hour >= DAY_START_HOUR && hour < EVENING_START_HOUR ? 'day' : 'evening'
}

/** Whether the current time falls in the automatic dark mode window (8pm to 5am). */
export function isAutoDarkModeTime(at: Date = currentTime()): boolean {
  const hour = at.getHours()
  return hour >= DARK_MODE_START_HOUR || hour < DARK_MODE_END_HOUR
}

export function addDaysToIsoDate(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00`)
  date.setDate(date.getDate() + days)
  return toIsoDate(date)
}

export function tomorrow() {
  return addDaysToIsoDate(journalDay(), 1)
}

/** The Sunday (as YYYY-MM-DD) of the week containing `isoDate` (defaults to the current journal day). */
export function weekStartOf(isoDate?: string) {
  const base = new Date(`${isoDate ?? journalDay()}T12:00:00`)
  const day = base.getDay() // 0 = Sunday
  base.setDate(base.getDate() - day)
  return toIsoDate(base)
}

export function weekAgo() {
  return addDaysToIsoDate(journalDay(), -7)
}

export function formatDate(date: string, long = false) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: long ? 'long' : 'short',
    month: 'long',
    day: 'numeric',
    year: long ? 'numeric' : undefined,
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`))
}

export function formatShortDate(date: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${date}T12:00:00Z`))
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

function buildIsoDate(year: number, month: number, day: number): string | null {
  let y = year
  if (y < 100) y += 2000
  if (!isValidCalendarDate(y, month, day)) return null
  return `${y}-${pad(month)}-${pad(day)}`
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
}

const DAYS_OF_WEEK: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
}

/** Parse a user-typed due date into an ISO "yyyy-mm-dd" string.
 * Supports quick formats like:
 *   - "1004" -> October 4th
 *   - "104" -> October 4th
 *   - "10/4", "10/04", "10-04", "10.04"
 *   - "10/04/26", "10/04/2026", "2026-10-04"
 *   - "oct 4", "october 4th"
 *   - "today", "tomorrow", day names ("fri")
 * A missing year defaults to the current year. Returns null when the input is empty
 * or not a valid calendar date (e.g. "2/30" or "1032"). */
export function parseDueDateInput(value: string): string | null {
  const raw = value.trim()
  if (!raw) return null

  const currentYear = new Date().getFullYear()

  // 1. Quick numeric formats without separators: "1004" -> Oct 4, "104" -> Oct 4, "100426", "20261004"
  const digits = raw.replace(/^#/, '')
  if (/^\d{3,8}$/.test(digits)) {
    if (digits.length === 4) {
      // MMDD, e.g. 1004 -> Oct 4
      const month = Number(digits.slice(0, 2))
      const day = Number(digits.slice(2, 4))
      const iso = buildIsoDate(currentYear, month, day)
      if (iso) return iso
    } else if (digits.length === 3) {
      // e.g. 104 -> month 10, day 4 (Oct 4)
      const m1 = Number(digits.slice(0, 2))
      const d1 = Number(digits.slice(2))
      if (m1 >= 10 && m1 <= 12 && d1 >= 1 && d1 <= 9) {
        const iso = buildIsoDate(currentYear, m1, d1)
        if (iso) return iso
      }
      // e.g. 415 -> month 4, day 15 (Apr 15)
      const m2 = Number(digits.slice(0, 1))
      const d2 = Number(digits.slice(1))
      const iso = buildIsoDate(currentYear, m2, d2)
      if (iso) return iso
    } else if (digits.length === 6) {
      // MMDDYY: e.g. 100426 -> Oct 4, 2026
      const month = Number(digits.slice(0, 2))
      const day = Number(digits.slice(2, 4))
      const year = Number(digits.slice(4, 6))
      const iso = buildIsoDate(year, month, day)
      if (iso) return iso
    } else if (digits.length === 8) {
      // YYYYMMDD
      const first4 = Number(digits.slice(0, 4))
      if (first4 >= 1900 && first4 <= 2099) {
        const iso = buildIsoDate(first4, Number(digits.slice(4, 6)), Number(digits.slice(6, 8)))
        if (iso) return iso
      }
      // MMDDYYYY
      const last4 = Number(digits.slice(4, 8))
      if (last4 >= 1900 && last4 <= 2099) {
        const iso = buildIsoDate(last4, Number(digits.slice(0, 2)), Number(digits.slice(2, 4)))
        if (iso) return iso
      }
    }
  }

  // 2. Relative words: "today", "tomorrow", day of week
  const lower = raw.toLowerCase()
  if (lower === 'today' || lower === 'tod') return journalDay()
  if (lower === 'tomorrow' || lower === 'tom') return tomorrow()
  if (lower === 'yesterday') return addDaysToIsoDate(journalDay(), -1)

  if (lower in DAYS_OF_WEEK) {
    const targetDay = DAYS_OF_WEEK[lower]
    const base = new Date(`${journalDay()}T12:00:00`)
    const currentDay = base.getDay()
    let diff = targetDay - currentDay
    if (diff <= 0) diff += 7
    base.setDate(base.getDate() + diff)
    return toIsoDate(base)
  }

  // 3. Named months: "oct 4", "october 4th", "oct 4 2026"
  const cleanedWords = lower.replace(/,/g, ' ').replace(/(\d+)(st|nd|rd|th)\b/gi, '$1').trim()
  const wordTokens = cleanedWords.split(/\s+/).filter(Boolean)
  if (wordTokens.length === 2) {
    const m1 = MONTH_NAMES[wordTokens[0]]
    const d1 = Number(wordTokens[1])
    if (m1 && Number.isInteger(d1)) {
      const iso = buildIsoDate(currentYear, m1, d1)
      if (iso) return iso
    }
    const d2 = Number(wordTokens[0])
    const m2 = MONTH_NAMES[wordTokens[1]]
    if (m2 && Number.isInteger(d2)) {
      const iso = buildIsoDate(currentYear, m2, d2)
      if (iso) return iso
    }
  } else if (wordTokens.length === 3) {
    const m1 = MONTH_NAMES[wordTokens[0]]
    const d1 = Number(wordTokens[1])
    const y1 = Number(wordTokens[2])
    if (m1 && Number.isInteger(d1) && Number.isInteger(y1)) {
      const iso = buildIsoDate(y1, m1, d1)
      if (iso) return iso
    }
    const d2 = Number(wordTokens[0])
    const m2 = MONTH_NAMES[wordTokens[1]]
    const y2 = Number(wordTokens[2])
    if (m2 && Number.isInteger(d2) && Number.isInteger(y2)) {
      const iso = buildIsoDate(y2, m2, d2)
      if (iso) return iso
    }
  }

  // 4. Delimited dates: "mm/dd", "mm/dd/yy", "yyyy-mm-dd", "mm.dd", "mm-dd"
  const parts = raw.split(/[/.\- ]+/).filter(Boolean)
  if (parts.length === 2) {
    const month = Number(parts[0])
    const day = Number(parts[1])
    if (Number.isInteger(month) && Number.isInteger(day)) {
      const iso = buildIsoDate(currentYear, month, day)
      if (iso) return iso
    }
  } else if (parts.length === 3) {
    if (parts[0].length === 4) {
      // YYYY-MM-DD
      const year = Number(parts[0])
      const month = Number(parts[1])
      const day = Number(parts[2])
      if (Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)) {
        const iso = buildIsoDate(year, month, day)
        if (iso) return iso
      }
    } else {
      // MM/DD/YYYY or MM/DD/YY
      const month = Number(parts[0])
      const day = Number(parts[1])
      const year = Number(parts[2])
      if (Number.isInteger(month) && Number.isInteger(day) && Number.isInteger(year)) {
        const iso = buildIsoDate(year, month, day)
        if (iso) return iso
      }
    }
  }

  return null
}

/** Extracts an optional inline due date from a task string like "File taxes due 1004"
 * or "Call dentist by tomorrow" or "Update slides @1004".
 * Returns null if no valid due date pattern is found. */
export function extractInlineDueDate(text: string): { text: string; dueDate: string } | null {
  const match = text.match(/^(.*?)(?:\s+)(?:(?:due:?|by)\s+|@\s*)([^,;]+)$/i)
  if (!match) return null
  const cleanTitle = match[1].trim()
  const rawDate = match[2].trim()
  if (!cleanTitle || !rawDate) return null
  const parsed = parseDueDateInput(rawDate)
  if (!parsed) return null
  return { text: cleanTitle, dueDate: parsed }
}

export function formatWeekRange(weekStartIso: string) {
  const end = addDaysToIsoDate(weekStartIso, 6)
  return `${formatShortDate(weekStartIso)} \u2013 ${formatShortDate(end)}`
}

/** A relative label for the entry list: Today, Yesterday, or the date. */
export function relativeDayLabel(isoDate: string) {
  const day = journalDay()
  if (isoDate === day) return 'Today'
  if (isoDate === addDaysToIsoDate(day, -1)) return 'Yesterday'
  return formatDate(isoDate)
}

export function greetingFor(at: Date = currentTime()) {
  const hour = at.getHours()
  if (hour < DAY_START_HOUR) return 'Still up'
  if (hour < 12) return 'Good morning'
  if (hour < EVENING_START_HOUR) return 'Good afternoon'
  return 'Good evening'
}

/** Splits a "remind_at" ISO datetime (naive-local, stored with a Z suffix) into
 * separate <input type="date"> / <input type="time"> values without any timezone shift. */
export function splitRemindAt(remindAt: string | null): { date: string; time: string } {
  if (!remindAt) return { date: tomorrow(), time: '09:00' }
  const match = remindAt.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
  return match ? { date: match[1], time: match[2] } : { date: tomorrow(), time: '09:00' }
}

export function combineToRemindAt(date: string, time: string): string {
  return `${date}T${time || '09:00'}:00Z`
}

export function durationMinutesFromTimes(startTime: string, endTime: string): number | null {
  const [startHour, startMinute] = startTime.split(':').map(Number)
  const [endHour, endMinute] = endTime.split(':').map(Number)
  if ([startHour, startMinute, endHour, endMinute].some((value) => Number.isNaN(value))) return null
  const startTotal = startHour * 60 + startMinute
  const endTotal = endHour * 60 + endMinute
  if (endTotal <= startTotal) return null
  return endTotal - startTotal
}

export function endTimeFromRemindAt(remindAt: string | null, durationMinutes = 15): string {
  const { time } = splitRemindAt(remindAt)
  const [hourStr, minuteStr] = time.split(':')
  const total = Number(hourStr) * 60 + Number(minuteStr) + durationMinutes
  const endHour = Math.floor((total % (24 * 60)) / 60)
  const endMinute = total % 60
  return `${pad(endHour)}:${pad(endMinute)}`
}

export function formatTime(time: string) {
  const [hourStr, minuteStr] = time.split(':')
  const hour = Number(hourStr)
  const displayHour = ((hour + 11) % 12) + 1
  return `${displayHour}:${minuteStr} ${hour >= 12 ? 'PM' : 'AM'}`
}

export function formatRemindAt(remindAt: string) {
  const { date, time } = splitRemindAt(remindAt)
  if (!date) return ''
  return `${relativeDayLabel(date)} \u00b7 ${formatTime(time)}`
}
