import { BookOpen, Clock, PenLine, Search } from 'lucide-react'
import { relativeDayLabel } from '../lib/day'
import { entryTitle } from '../lib/entries'
import { useJournal } from '../state/journalContext'
import { Sheet } from './ui/Sheet'

export function HistoryPanel() {
  const {
    panel, closePanel, filteredEntries, search, setSearch, loading, openEntry, activeEntry,
    entryListRef, openComposer,
  } = useJournal()

  return (
    <Sheet
      open={panel === 'history'}
      onClose={closePanel}
      side="left"
      eyebrow={<><Clock /> Your journal</>}
      title="History"
      subtitle="Everything you've written, newest first."
    >
      <label className="search-box">
        <Search />
        <span className="sr-only">Search entries</span>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search your journal..."
        />
      </label>

      <div className="entry-list" ref={entryListRef}>
        {loading ? (
          <div className="skeleton-list" aria-label="Loading entries">
            {[1, 2, 3].map((item) => <span key={item} />)}
          </div>
        ) : filteredEntries.length ? filteredEntries.map((entry) => (
          <button
            className={activeEntry?.id === entry.id ? 'entry-item active' : 'entry-item'}
            data-entry-id={entry.id}
            key={entry.id}
            onClick={() => openEntry(entry)}
          >
            <span className="entry-item-date">{relativeDayLabel(entry.date)}</span>
            <strong>{entryTitle(entry)}</strong>
            <span className="entry-preview">{entry.raw_transcript}</span>
          </button>
        )) : (
          <div className="empty-state">
            <span><BookOpen /></span>
            <strong>{search ? 'No entries found' : 'Your story starts here'}</strong>
            <p>{search ? 'Try a different search.' : 'Write a few words about your day. There’s no right way to begin.'}</p>
            {!search && (
              <button className="primary-button" onClick={() => openComposer()}>
                <PenLine /> Write an entry
              </button>
            )}
          </div>
        )}
      </div>
    </Sheet>
  )
}
