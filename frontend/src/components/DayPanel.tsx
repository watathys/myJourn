import {
  BookOpenCheck, ChevronDown, ChevronUp, Moon, PenLine, Plus, Sun, Sunrise,
} from 'lucide-react'
import { greetingFor, formatDate } from '../lib/day'
import { countWords } from '../lib/entries'
import { useJournal } from '../state/journalContext'

/** The one prompt at the top of the home screen. It never hides tasks or goals. */
export function DayPanel() {
  const {
    dayState, phase, todayIso, todayEntry, plannedTasks, doneTodayCount, morningSelectedIds,
    saveDayPlan, savingMorningPlan, planEditing, setPlanEditing, startEditingPlan, dailyPlan,
    openComposer, openEntry, dayPanelCollapsed, setDayPanelCollapsed, visibleTasks,
  } = useJournal()

  const eyebrow = {
    plan: <><Sunrise /> Morning</>,
    focus: <><Sun /> Your day</>,
    reflect: <><Moon /> Evening</>,
    closed: <><BookOpenCheck /> Day closed</>,
  }[dayState]

  const title = {
    plan: planEditing ? 'Re-pick today’s tasks' : 'Get ready for the day',
    focus: 'Today’s focus',
    reflect: 'How did today go?',
    closed: 'Tonight’s reflection is saved',
  }[dayState]

  const subtitle = {
    plan: 'Pick the tasks you want to focus on today. A shorter list is easier to finish.',
    focus: plannedTasks.length
      ? `${doneTodayCount} of ${plannedTasks.length} done so far.`
      : 'Nothing picked for today yet — add a few tasks below whenever you like.',
    reflect: 'Check off what you finished below, then write tonight’s entry.',
    closed: todayEntry ? `${countWords(todayEntry.raw_transcript)} words written today.` : '',
  }[dayState]

  const progress = plannedTasks.length ? Math.round((doneTodayCount / plannedTasks.length) * 100) : 0

  return (
    <section className={`day-panel day-panel-${dayState}`}>
      <header className="day-panel-head">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h1>{title}</h1>
          <p className="day-panel-date">
            {greetingFor()} · {formatDate(todayIso, true)}
          </p>
        </div>
        <button
          className="icon-button"
          onClick={() => setDayPanelCollapsed(!dayPanelCollapsed)}
          aria-expanded={!dayPanelCollapsed}
          aria-label={dayPanelCollapsed ? 'Expand today' : 'Collapse today'}
        >
          {dayPanelCollapsed ? <ChevronDown /> : <ChevronUp />}
        </button>
      </header>

      {!dayPanelCollapsed && (
        <div className="day-panel-body">
          {subtitle && <p className="day-panel-sub">{subtitle}</p>}

          {dayState === 'focus' && plannedTasks.length > 0 && (
            <div className="progress-track" role="img" aria-label={`${progress}% of today's tasks done`}>
              <span style={{ width: `${progress}%` }} />
            </div>
          )}

          <div className="day-panel-actions">
            {dayState === 'plan' && (
              <>
                <button
                  className="primary-button large"
                  disabled={savingMorningPlan}
                  onClick={() => void saveDayPlan(morningSelectedIds)}
                >
                  {savingMorningPlan ? <span className="button-spinner" /> : <Sunrise />}
                  {planEditing
                    ? 'Save today’s plan'
                    : morningSelectedIds.length
                      ? `Start my day · ${morningSelectedIds.length}`
                      : 'Start my day'}
                </button>
                {planEditing ? (
                  <button className="ghost-button" onClick={() => setPlanEditing(false)}>Cancel</button>
                ) : (
                  <button
                    className="ghost-button"
                    disabled={savingMorningPlan}
                    onClick={() => void saveDayPlan([])}
                  >
                    Skip planning
                  </button>
                )}
                {!visibleTasks.length && (
                  <span className="day-panel-hint">Add your first task below to plan a day.</span>
                )}
              </>
            )}

            {dayState === 'focus' && (
              <>
                <button className="primary-button" onClick={() => openComposer()}>
                  <PenLine /> Write an entry
                </button>
                <button className="ghost-button" onClick={startEditingPlan}>
                  {dailyPlan?.selected_task_ids.length ? 'Re-pick today’s tasks' : 'Pick tasks for today'}
                </button>
              </>
            )}

            {dayState === 'reflect' && (
              <>
                <button className="primary-button large" onClick={() => openComposer()}>
                  <PenLine /> Write tonight’s reflection
                </button>
                {!plannedTasks.length && (
                  <button className="ghost-button" onClick={startEditingPlan}>
                    <Plus /> Pick tasks for today
                  </button>
                )}
              </>
            )}

            {dayState === 'closed' && todayEntry && (
              <>
                <button className="primary-button" onClick={() => openEntry(todayEntry)}>
                  Read tonight’s reflection
                </button>
                <button
                  className="ghost-button"
                  onClick={() => openComposer({ prefill: '', append: { id: todayEntry.id, date: todayEntry.date } })}
                >
                  <Plus /> Add to it
                </button>
              </>
            )}
          </div>

          {dayState === 'plan' && phase === 'evening' && (
            <p className="day-panel-hint">
              It’s already evening — pick what you did today, then write your reflection.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
