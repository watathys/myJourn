import { createContext, useContext } from 'react'
import type { JournalState } from './useJournalState'

export const JournalContext = createContext<JournalState | null>(null)

export function useJournal(): JournalState {
  const value = useContext(JournalContext)
  if (!value) throw new Error('useJournal must be used inside JournalContext.Provider')
  return value
}
