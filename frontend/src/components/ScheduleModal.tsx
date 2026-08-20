import { useState } from 'react'
import { AlarmClock, Bell, Check, Link2, X } from 'lucide-react'
import { durationMinutesFromTimes, endTimeFromRemindAt, journalDay, splitRemindAt } from '../lib/day'
import { useJournal } from '../state/journalContext'

export function ScheduleModal() {
  const {
    scheduleTarget, setScheduleTarget, savingSchedule, saveScheduleModal, clearScheduleModal,
    googleStatus, connectGoogle, connectingGoogle,
  } = useJournal()

  if (!scheduleTarget) return null
  return <ScheduleModalForm
    key={`${scheduleTarget.item.id}-${scheduleTarget.mode}`}
    onClose={() => setScheduleTarget(null)}
    onSave={saveScheduleModal}
    onClear={scheduleTarget.mode === 'reminder'
      ? (scheduleTarget.item.remind_at ? clearScheduleModal : null)
      : (scheduleTarget.item.snoozed_until ? clearScheduleModal : null)}
    saving={savingSchedule}
    googleConnected={Boolean(googleStatus?.connected)}
    onConnectGoogle={connectGoogle}
    connectingGoogle={connectingGoogle}
    itemText={scheduleTarget.item.goal_text}
    mode={scheduleTarget.mode}
    remindAt={scheduleTarget.mode === 'snooze'
      ? scheduleTarget.item.remind_at
        ?? (scheduleTarget.item.snoozed_until ? `${scheduleTarget.item.snoozed_until}T09:00:00Z` : null)
      : scheduleTarget.item.remind_at ?? null}
  />
}

function ScheduleModalForm({
  onClose, onSave, onClear, saving, googleConnected, onConnectGoogle, connectingGoogle, itemText, mode,
  remindAt,
}: {
  onClose: () => void
  onSave: (date: string, time: string, endTime: string) => void
  onClear: (() => void) | null
  saving: boolean
  googleConnected: boolean
  onConnectGoogle: () => void
  connectingGoogle: boolean
  itemText: string
  mode: 'reminder' | 'snooze'
  remindAt: string | null
}) {
  const initial = splitRemindAt(remindAt)
  const [date, setDate] = useState(initial.date)
  const [time, setTime] = useState(initial.time)
  const [endTime, setEndTime] = useState(() => endTimeFromRemindAt(remindAt))
  const isReminder = mode === 'reminder'

  return (
    <div className="modal-layer" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <span className="card-icon">{isReminder ? <Bell /> : <AlarmClock />}</span>
          <div>
            <h2>{isReminder ? 'Schedule a reminder' : 'Remind me later'}</h2>
            <p>
              {isReminder
                ? `When should “${itemText}” show up?`
                : `Hide “${itemText}” until this date. It comes back highlighted.`}
            </p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X /></button>
        </header>

        {isReminder && !googleConnected && (
          <div className="modal-notice">
            <p>Connect Google Calendar so this reminder appears on your calendar with a notification.</p>
            <button className="ghost-button" disabled={connectingGoogle} onClick={onConnectGoogle}>
              {connectingGoogle ? <span className="button-spinner" /> : <Link2 />} Connect
            </button>
          </div>
        )}

        <div className="modal-fields">
          <label>
            <span>Date</span>
            <input
              type="date"
              value={date}
              min={journalDay()}
              onChange={(event) => setDate(event.target.value)}
              autoFocus
            />
          </label>
          <label>
            <span>{isReminder ? 'Starts' : 'Time'}</span>
            <input
              type="time"
              value={time}
              onChange={(event) => {
                const next = event.target.value
                setTime(next)
                if (isReminder && endTime && durationMinutesFromTimes(next, endTime) == null) {
                  setEndTime(endTimeFromRemindAt(`${date}T${next}:00Z`))
                }
              }}
            />
          </label>
          {isReminder && (
            <label>
              <span>Ends</span>
              <input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
            </label>
          )}
        </div>

        <div className="modal-actions">
          {onClear && (
            <button className="ghost-button" disabled={saving} onClick={onClear}>
              {isReminder ? 'Remove reminder' : 'Unsnooze'}
            </button>
          )}
          <button className="primary-button" disabled={saving || !date} onClick={() => onSave(date, time, endTime)}>
            {saving ? <span className="button-spinner" /> : <Check />}
            {isReminder && googleConnected ? 'Add to calendar' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
