import {
  CalendarDays, CalendarRange, Check, ChevronRight, Compass, Link2, LogOut, Plus, Settings,
  SpellCheck, Trash2, Unlink, Upload,
} from 'lucide-react'
import { journalDay } from '../lib/day'
import { useJournal } from '../state/journalContext'
import { Card, EmptyNote } from './ui/Card'
import { Sheet } from './ui/Sheet'

export function SettingsPanel() {
  const {
    panel, closePanel, northStar, setNorthStar, savedNorthStar, savingSettings, updateNorthStar,
    googleStatus, connectGoogle, disconnectGoogleAccount, connectingGoogle, spellingCorrections,
    newIncorrectDraft, setNewIncorrectDraft, newCorrectDraft, setNewCorrectDraft, addingCorrection,
    addSpellingCorrection, deletingCorrectionId, removeSpellingCorrection, importRows, addImportRow,
    removeImportRow, updateImportRow, importBulkText, setImportBulkText, parseBulkImport, importing,
    importProgress, startImport, sessionUser, signOut,
  } = useJournal()

  const stagedCount = importRows.filter((row) => row.date && row.text.trim()).length

  return (
    <Sheet
      open={panel === 'settings'}
      onClose={closePanel}
      size="wide"
      eyebrow={<><Settings /> Your setup</>}
      title="Settings"
      subtitle="Context for Percy, calendar, spelling, imports, and your account."
    >
      <Card title="Your North Star" eyebrow="Optional" icon={<Compass />}>
        <p className="alignment">
          What matters to you. Percy uses this to notice when your days line up with it.
        </p>
        <textarea
          value={northStar}
          onChange={(event) => setNorthStar(event.target.value)}
          placeholder="For example: Be present with the people I love, keep learning, and make things that matter."
          rows={5}
          aria-label="Your North Star"
        />
        <div className="card-actions">
          <span className="card-eyebrow">{northStar.length.toLocaleString()} characters</span>
          <button
            className="primary-button"
            disabled={savingSettings || northStar === savedNorthStar}
            onClick={updateNorthStar}
          >
            {savingSettings ? <span className="button-spinner" /> : <Check />}
            {savingSettings ? 'Saving...' : northStar === savedNorthStar ? 'Saved' : 'Save changes'}
          </button>
        </div>
      </Card>

      <Card title="Google Calendar" eyebrow="Reminders" icon={<CalendarRange />}>
        <p className="alignment">
          Connect your Google account so scheduled reminders show up as calendar events with phone
          notifications.
        </p>
        {googleStatus?.connected ? (
          <div className="card-actions">
            <span className="tag tag-ok">
              <Link2 /> Connected{googleStatus.email ? ` as ${googleStatus.email}` : ''}
            </span>
            <button className="ghost-button" disabled={connectingGoogle} onClick={disconnectGoogleAccount}>
              <Unlink /> Disconnect
            </button>
          </div>
        ) : (
          <button className="primary-button" disabled={connectingGoogle} onClick={connectGoogle}>
            {connectingGoogle ? <span className="button-spinner" /> : <Link2 />} Connect Google Calendar
          </button>
        )}
      </Card>

      <Card title="Learned spelling" icon={<SpellCheck />} count={spellingCorrections.length}>
        <p className="alignment">
          Speech-to-text often mishears names. When you edit an entry, Bookends learns the correction so
          future entries are spelled right.
        </p>
        {spellingCorrections.length > 0 && (
          <ul className="note-list">
            {spellingCorrections.map((correction) => (
              <li key={correction.id}>
                <p>
                  <code>{correction.incorrect_word}</code> → <strong>{correction.correct_word}</strong>
                  {correction.correction_count > 1 && (
                    <span className="card-eyebrow"> {correction.correction_count}× corrected</span>
                  )}
                </p>
                <button
                  className="icon-button"
                  disabled={deletingCorrectionId === correction.id}
                  onClick={() => removeSpellingCorrection(correction.id)}
                  aria-label={`Remove correction for ${correction.incorrect_word}`}
                  title="Remove"
                >
                  <Trash2 />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="inline-form">
          <input
            value={newIncorrectDraft}
            onChange={(event) => setNewIncorrectDraft(event.target.value)}
            placeholder="Misspelling"
            aria-label="Misheard word or misspelling"
          />
          <input
            value={newCorrectDraft}
            onChange={(event) => setNewCorrectDraft(event.target.value)}
            placeholder="Correct spelling"
            aria-label="Correct spelling"
            onKeyDown={(event) => { if (event.key === 'Enter') void addSpellingCorrection() }}
          />
          <button
            className="ghost-button"
            disabled={!newIncorrectDraft.trim() || !newCorrectDraft.trim() || addingCorrection}
            onClick={addSpellingCorrection}
          >
            {addingCorrection ? <span className="button-spinner" /> : <Plus />} Add
          </button>
        </div>
      </Card>

      <Card title="Import past journals" eyebrow="Migrate your history" icon={<Upload />}>
        <p className="alignment">
          Paste entries you wrote elsewhere. Each one runs through the same reflection engine, in date
          order, so patterns and open loops get picked up.
        </p>
        <textarea
          value={importBulkText}
          onChange={(event) => setImportBulkText(event.target.value)}
          placeholder={'2024-01-15\nToday I finally started running again...\n\n2024-01-16\nRough night of sleep, but a good talk with...'}
          rows={6}
          aria-label="Paste multiple entries"
        />
        <div className="card-actions">
          <span className="card-eyebrow">{stagedCount} staged below</span>
          <button className="ghost-button" disabled={!importBulkText.trim()} onClick={parseBulkImport}>
            <ChevronRight /> Parse into entries
          </button>
        </div>

        <div className="import-rows">
          {importRows.map((row, index) => (
            <div className="import-row" key={row.id}>
              <div className="import-row-head">
                <span>Entry {index + 1}</span>
                <label className="date-control">
                  <CalendarDays />
                  <span className="sr-only">Entry date</span>
                  <input
                    type="date"
                    value={row.date}
                    max={journalDay()}
                    onChange={(event) => updateImportRow(row.id, 'date', event.target.value)}
                    disabled={importing}
                  />
                </label>
                <button
                  className="icon-button"
                  onClick={() => removeImportRow(row.id)}
                  disabled={importing || importRows.length === 1}
                  aria-label="Remove this entry"
                >
                  <Trash2 />
                </button>
              </div>
              <textarea
                aria-label={`Entry ${index + 1} text`}
                value={row.text}
                onChange={(event) => updateImportRow(row.id, 'text', event.target.value)}
                placeholder="What happened that day..."
                rows={3}
                disabled={importing}
              />
            </div>
          ))}
        </div>

        <div className="card-actions">
          <button className="ghost-button" onClick={addImportRow} disabled={importing}>
            <Plus /> Add another day
          </button>
          <button className="primary-button" disabled={importing || !stagedCount} onClick={startImport}>
            {importing ? <span className="button-spinner" /> : <Upload />}
            {importing && importProgress
              ? `Importing ${Math.min(importProgress.done + 1, importProgress.total)} of ${importProgress.total}...`
              : `Import ${stagedCount} ${stagedCount === 1 ? 'entry' : 'entries'}`}
          </button>
        </div>
      </Card>

      <Card title="Account">
        {sessionUser?.email
          ? <p className="alignment">Signed in as <strong>{sessionUser.email}</strong></p>
          : <EmptyNote>Signed in.</EmptyNote>}
        <button className="ghost-button danger" onClick={signOut}>
          <LogOut /> Sign out
        </button>
      </Card>
    </Sheet>
  )
}
