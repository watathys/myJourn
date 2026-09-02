import { BookOpen, CalendarRange, Clock, Compass, Moon, PenLine, Settings, Sparkles, Sun } from 'lucide-react'
import { useJournal } from '../state/journalContext'
import type { PanelId } from '../state/useJournalState'

type NavItem = { id: PanelId; label: string; icon: typeof Clock; badge?: boolean }

export function NavRail() {
  const {
    activePage, goHome, panel, openPanel, closePanel, openComposer, unreadInsightCount, entries, activeEntry,
    isDarkMode, toggleThemeMode,
  } = useJournal()

  const items: NavItem[] = [
    { id: 'journal', label: 'Journal', icon: BookOpen },
    { id: 'weekly', label: 'Weekly', icon: CalendarRange },
    { id: 'percy', label: 'Percy', icon: Sparkles, badge: unreadInsightCount > 0 },
    { id: 'settings', label: 'Settings', icon: Settings },
  ]

  return (
    <nav className="rail" aria-label="Primary navigation">
      <button className="rail-brand" onClick={goHome} title="Bookends home">
        <span className="rail-brand-mark"><BookOpen /></span>
        <span className="rail-brand-name">Bookends</span>
      </button>

      <button
        className={activePage === 'write' ? 'rail-write active' : 'rail-write'}
        onClick={() => openComposer()}
        title="Write an entry"
      >
        <PenLine />
        <span>Write</span>
      </button>

      <div className="rail-items">
        <button
          className={activePage === 'home' && !panel && !activeEntry ? 'rail-item active' : 'rail-item'}
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

      <button
        className="rail-theme-toggle"
        onClick={toggleThemeMode}
        title={isDarkMode ? 'Switch to light theme' : 'Switch to dark theme'}
        aria-label={isDarkMode ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        {isDarkMode ? <Moon /> : <Sun />}
      </button>

      <p className="rail-foot">{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</p>
    </nav>
  )
}
