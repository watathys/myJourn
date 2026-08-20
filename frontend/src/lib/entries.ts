import type { JournalEntry, Task } from '../api'

const MOBILE_BREAKPOINT = '(max-width: 900px)'

export function isMobileViewport() {
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_BREAKPOINT).matches
}

export function compareEntries(a: JournalEntry, b: JournalEntry) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1
  const aCreated = a.created_at ?? ''
  const bCreated = b.created_at ?? ''
  if (aCreated === bCreated) return 0
  return aCreated < bCreated ? 1 : -1
}

export function entryTitle(entry: JournalEntry) {
  const source = entry.formatted_narrative || entry.raw_transcript
  return source.split(/\n|[.!?]\s/)[0].replace(/^#+\s*/, '').trim().slice(0, 46) || 'Untitled entry'
}

export function sortWorkingTasks(list: Task[]) {
  return [...list]
    .filter((task) => task.status !== 'abandoned')
    .sort((a, b) => {
      const aDone = a.status === 'completed' ? 1 : 0
      const bDone = b.status === 'completed' ? 1 : 0
      return aDone - bDone
    })
}

export function countWords(text: string) {
  const clean = text.trim()
  return clean ? clean.split(/\s+/).length : 0
}

export function taskProgress(item: { status: string; target_count?: number; current_count?: number }) {
  const isCompleted = item.status === 'completed'
  const targetCount = item.target_count ?? 1
  const currentCount = item.current_count ?? (isCompleted ? targetCount : 0)
  return { isCompleted, targetCount, currentCount }
}
