import { Analytics } from '@vercel/analytics/react'
import { useState, type ReactNode } from 'react'
import { Auth } from './Auth'
import { AppShell } from './components/AppShell'
import { LandingPage } from './components/LandingPage'
import { JournalContext } from './state/journalContext'
import { useJournalState } from './state/useJournalState'
import './App.css'

type AuthMode = 'signIn' | 'signUp'

export default function App() {
  const state = useJournalState()
  const [authMode, setAuthMode] = useState<AuthMode | null>(null)

  let content: ReactNode
  if (state.authChecking) {
    content = (
      <div className="auth-container">
        <p className="auth-subtitle">Loading your journal...</p>
      </div>
    )
  } else if (!state.sessionUser) {
    content = authMode ? (
      <Auth
        onAuthSuccess={() => {}}
        initialMode={authMode}
        onBack={() => setAuthMode(null)}
      />
    ) : (
      <LandingPage
        onSignIn={() => setAuthMode('signIn')}
        onGetStarted={() => setAuthMode('signUp')}
      />
    )
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
