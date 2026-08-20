import { X } from 'lucide-react'
import { useJournal } from '../state/journalContext'
import { ComposerSheet } from './ComposerSheet'
import { EntryReader } from './EntryReader'
import { HistoryPanel } from './HistoryPanel'
import { HomeView } from './HomeView'
import { NavRail } from './NavRail'
import { PercyPanel } from './PercyPanel'
import { ScheduleModal } from './ScheduleModal'
import { SettingsPanel } from './SettingsPanel'
import { WeeklyPanel } from './WeeklyPanel'

export function AppShell() {
  const { error, setError, notice, setNotice } = useJournal()

  return (
    <div className="shell">
      <NavRail />

      <main className="workspace">
        <HomeView />
      </main>

      <div className="toasts">
        {error && (
          <div className="toast toast-error" role="alert">
            <span>{error}</span>
            <button onClick={() => setError('')} aria-label="Dismiss"><X /></button>
          </div>
        )}
        {notice && (
          <div className="toast" role="status">
            <span>{notice}</span>
            <button onClick={() => setNotice('')} aria-label="Dismiss"><X /></button>
          </div>
        )}
      </div>

      <HistoryPanel />
      <WeeklyPanel />
      <PercyPanel />
      <SettingsPanel />
      <EntryReader />
      <ComposerSheet />
      <ScheduleModal />
    </div>
  )
}
