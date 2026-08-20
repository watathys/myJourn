import { BookOpen, CalendarRange, Clock, Compass, PenLine, Settings, Sparkles } from 'lucide-react'
import { useJournal } from '../state/journalContext'
import type { PanelId } from '../state/useJournalState'

type NavItem = { id: PanelId; label: string; icon: typeof Clock; badge?: boolean }

export function NavRail() {
  const {
    panel, openPanel, closePanel, openComposer, unreadInsightCount, entries, activeEntry, closeEntry,
  } = useJournal()

  const items: NavItem[] = [
    { id: 'history', label: 'History', icon: Clock },
    { id: 'weekly', label: 'Weekly', icon: CalendarRange },
    { id: 'percy', label: 'Percy', icon: Sparkles, badge: unreadInsightCount > 0 },
    { id: 'settings', label: 'Settings', icon: Settings },
  ]

  function goHome() {
    closePanel()
    closeEntry()
  }

  return (
    <nav className="rail" aria-label="Primary navigation">
      <button className="rail-brand" onClick={goHome} title="Bookends home">
        <span className="rail-brand-mark"><BookOpen /></span>
        <span className="rail-brand-name">Bookends</span>
      </button>

      <button className="rail-write" onClick={() => openComposer()} title="Write an entry">
        <PenLine />
        <span>Write</span>
      </button>

      <div className="rail-items">
        <button
          className={!panel && !activeEntry ? 'rail-item active' : 'rail-item'}
          onClick={goHome}
          title="Today"
        >
          <Compass />
          <span>Today</span>
        </button>
        {items.map(({ id, label, icon: Icon, badge }) => (
          <button
            key={id}
            className={panel === id ? 'rail-item active' : 'rail-item'}
            onClick={() => (panel === id ? closePanel() : openPanel(id))}
            title={label}
          >
            <Icon />
            <span>{label}</span>
            {badge && <em className="rail-dot" aria-label="New insights" />}
          </button>
        ))}
      </div>

      <p className="rail-foot">{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</p>
    </nav>
  )
}
