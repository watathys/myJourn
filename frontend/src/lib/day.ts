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

/** Parse a user-typed due date ("mm/dd", "mm/dd/yy", or "mm/dd/yyyy") into an
 * ISO "yyyy-mm-dd" string. A missing year defaults to the current year, and a
 * two-digit year is treated as 20xx. Returns null when the input is empty or
 * not a real calendar date (e.g. "2/30"). */
export function parseDueDateInput(value: string): string | null {
  const parts = value.trim().split(/[/.\- ]+/).filter(Boolean)
  if (parts.length < 2 || parts.length > 3) return null

  const month = Number(parts[0])
  const day = Number(parts[1])
  if (!Number.isInteger(month) || !Number.isInteger(day)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  let year: number
  if (parts.length === 3) {
    year = Number(parts[2])
    if (!Number.isInteger(year)) return null
    if (year < 100) year += 2000
  } else {
    year = new Date().getFullYear()
  }

  const date = new Date(year, month - 1, day)
  // Guard against rollovers like 2/30 -> March 2.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return toIsoDate(date)
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
