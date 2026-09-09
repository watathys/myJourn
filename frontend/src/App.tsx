import { Analytics } from '@vercel/analytics/react'
import type { ReactNode } from 'react'
import { Auth } from './Auth'
import { AppShell } from './components/AppShell'
import { JournalContext } from './state/journalContext'
import { useJournalState } from './state/useJournalState'
import './App.css'

export default function App() {
  const state = useJournalState()

  let content: ReactNode
  if (state.authChecking) {
    content = (
      <div className="auth-container">
        <p className="auth-subtitle">Loading your journal...</p>
      </div>
    )
  } else if (!state.sessionUser) {
    content = <Auth onAuthSuccess={() => {}} />
  } else {
    content = (
      <JournalContext.Provider value={state}>
        <AppShell />
      </JournalContext.Provider>
    )
  }

  return (
    <>
      <Analytics />
      {content}
    </>
  )
}
