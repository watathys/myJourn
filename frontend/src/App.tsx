import { Auth } from './Auth'
import { AppShell } from './components/AppShell'
import { JournalContext } from './state/journalContext'
import { useJournalState } from './state/useJournalState'
import './App.css'

export default function App() {
  const state = useJournalState()

  if (state.authChecking) {
    return (
      <div className="auth-container">
        <p className="auth-subtitle">Loading your journal...</p>
      </div>
    )
  }

  if (!state.sessionUser) {
    return <Auth onAuthSuccess={() => {}} />
  }

  return (
    <JournalContext.Provider value={state}>
      <AppShell />
    </JournalContext.Provider>
  )
}
