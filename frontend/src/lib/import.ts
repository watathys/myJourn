export type ImportRow = { id: string; date: string; text: string }

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

export function makeRowId() {
  return Math.random().toString(36).slice(2)
}

function parseDateHeader(line: string): string | null {
  const clean = line.trim().replace(/^#{1,6}\s*/, '').replace(/^[-*]\s*/, '').replace(/:$/, '').trim()
  if (!clean) return null

  const iso = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const slash = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
  if (slash) {
    const [, month, day, rawYear] = slash
    const year = rawYear.length === 2
      ? String(Number(rawYear) < 70 ? 2000 + Number(rawYear) : 1900 + Number(rawYear))
      : rawYear
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  const long = clean.match(/^(?:[A-Za-z]+,\s*)?([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/)
  if (long) {
    const monthIndex = MONTH_NAMES.indexOf(long[1].toLowerCase())
    if (monthIndex !== -1) {
      return `${long[3]}-${String(monthIndex + 1).padStart(2, '0')}-${long[2].padStart(2, '0')}`
    }
  }

  return null
}

export function parseBulkEntries(bulkText: string): ImportRow[] {
  const lines = bulkText.split('\n')
  const rows: ImportRow[] = []
  let currentDate: string | null = null
  let buffer: string[] = []

  function flush() {
    const text = buffer.join('\n').trim()
    if (currentDate && text) rows.push({ id: makeRowId(), date: currentDate, text })
    buffer = []
  }

  for (const line of lines) {
    const headerDate = parseDateHeader(line)
    if (headerDate) {
      flush()
      currentDate = headerDate
    } else {
      buffer.push(line)
    }
  }
  flush()

  return rows
}
