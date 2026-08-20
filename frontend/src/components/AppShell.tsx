import { X } from 'lucide-react'
import { useJournal } from '../state/journalContext'
import { EntryReader } from './EntryReader'
import { HomeView } from './HomeView'
import { JournalPanel } from './JournalPanel'
import { NavRail } from './NavRail'
import { PercyPanel } from './PercyPanel'
import { ScheduleModal } from './ScheduleModal'
import { SettingsPanel } from './SettingsPanel'
import { WeeklyPanel } from './WeeklyPanel'
import { WriteView } from './WriteView'

export function AppShell() {
  const { error, setError, notice, setNotice, activePage } = useJournal()

  return (
    <div className="shell">
      <NavRail />

      <main className="workspace">
        {activePage === 'write' ? <WriteView /> : <HomeView />}
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

      <JournalPanel />
      <WeeklyPanel />
      <PercyPanel />
      <SettingsPanel />
      <EntryReader />
      <ScheduleModal />
    </div>
  )
}
