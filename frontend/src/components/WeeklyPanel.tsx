import {
  CalendarRange, Check, CircleCheck, PlayCircle, Plus, RotateCcw, Sparkles,
} from 'lucide-react'
import type { WeeklyPlanningSession } from '../api'
import { formatDate, formatWeekRange } from '../lib/day'
import { useJournal } from '../state/journalContext'
import { Card, EmptyNote } from './ui/Card'
import { Sheet } from './ui/Sheet'
import { GoalRow } from './GoalRow'
import { TaskForm } from './TaskForm'
import { TaskRow } from './TaskRow'

const TARGET_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 30, 50, 100]

function ReflectionBlocks({ session }: { session: WeeklyPlanningSession }) {
  const data = session.reflection_data
  if (!data) return null
  return (
    <div className="reflection">
      {session.reflection_start_date && session.reflection_end_date && (
        <p className="card-eyebrow">
          Covering {formatDate(session.reflection_start_date)} – {formatDate(session.reflection_end_date)}
        </p>
      )}
      <p className="reflection-narrative">{data.summary_narrative}</p>
      <div className="reflection-grid">
        <div className="reflection-box">
          <h4>What went well</h4>
          <ul>{data.what_went_well.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </div>
        <div className="reflection-box">
          <h4>What was hard</h4>
          <ul>{data.what_was_hard.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </div>
      </div>
      {data.patterns_worth_noticing?.length > 0 && (
        <div className="reflection-box">
          <h4>Patterns worth noticing</h4>
          <ul>{data.patterns_worth_noticing.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </div>
      )}
      {data.suggested_focuses?.length > 0 && (
        <div className="reflection-box">
          <h4>Suggested focus for next week</h4>
          <ul>{data.suggested_focuses.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </div>
      )}
    </div>
  )
}

export function WeeklyPanel() {
  const {
    panel, closePanel, weekStart, weeklyLoading, weeklySessionChecked, weeklySession,
    startingWeeklyPlanning, beginStartWeeklyPlanning, reopenWeeklySession, generatingReflection,
    handleGenerateWeeklyReflection, percyReminders, dismissReminder, dismissingReminderId, visibleTasks,
    lastWeekGoals, weeklyWins, weeklyEntries, weeklyGoals, newGoalDraft, setNewGoalDraft,
    newGoalTargetCount, setNewGoalTargetCount, addingGoal, addWeeklyGoal, percyGoalQuery,
    setPercyGoalQuery, creatingPercyGoal, handlePercyCreateGoal, percyGoalReply,
    finishingWeeklyPlanning, finishWeeklySession,
  } = useJournal()

  return (
    <Sheet
      open={panel === 'weekly'}
      onClose={closePanel}
      size="wide"
      eyebrow={<><CalendarRange /> Weekly ritual</>}
      title="Weekly planning"
      subtitle={formatWeekRange(weekStart)}
    >
      {weeklyLoading || !weeklySessionChecked ? (
        <div className="skeleton-list">{[1, 2, 3].map((item) => <span key={item} />)}</div>
      ) : !weeklySession ? (
        <Card title="Start this week’s planning" eyebrow="Get started" icon={<PlayCircle />}>
          <p className="alignment">
            Review last week’s goals, clear out your notes, and set your intentions for the week ahead.
          </p>
          <button className="primary-button large" disabled={startingWeeklyPlanning} onClick={beginStartWeeklyPlanning}>
            {startingWeeklyPlanning ? <span className="button-spinner" /> : <PlayCircle />} Start weekly planning
          </button>
        </Card>
      ) : weeklySession.completed_at ? (
        <>
          <Card title="Weekly planning complete" eyebrow="All set" icon={<CircleCheck />}>
            <p className="alignment">
              Your goals for this week are saved. Check them off from the home screen as you go.
            </p>
            <button className="ghost-button" disabled={startingWeeklyPlanning} onClick={reopenWeeklySession}>
              <RotateCcw /> Re-open weekly planning
            </button>
          </Card>
          {weeklySession.reflection_data && (
            <Card title="Weekly AI reflection" eyebrow="Weekly digest" icon={<Sparkles />}>
              <ReflectionBlocks session={weeklySession} />
            </Card>
          )}
        </>
      ) : (
        <>
          <Card title="Weekly AI reflection" eyebrow="Weekly digest" icon={<Sparkles />}>
            {generatingReflection ? (
              <p className="alignment"><span className="button-spinner" /> Generating your weekly reflection...</p>
            ) : weeklySession.reflection_data ? (
              <>
                <ReflectionBlocks session={weeklySession} />
                <button className="text-button" disabled={generatingReflection} onClick={handleGenerateWeeklyReflection}>
                  <RotateCcw /> Regenerate
                </button>
              </>
            ) : (
              <>
                <p className="alignment">
                  A structured summary of your week: specific wins, genuine struggles, and suggested focus areas.
                </p>
                <button className="primary-button" disabled={generatingReflection} onClick={handleGenerateWeeklyReflection}>
                  <Sparkles /> Generate my weekly reflection
                </button>
              </>
            )}
          </Card>

          <Card title="Notes for this week" eyebrow="From you and Percy" count={percyReminders.length}>
            {percyReminders.length ? (
              <ul className="note-list">
                {percyReminders.map((reminder) => (
                  <li key={reminder.id}>
                    <p>{reminder.reminder_text}</p>
                    <button
                      className="icon-button"
                      disabled={dismissingReminderId === reminder.id}
                      onClick={() => dismissReminder(reminder.id)}
                      aria-label="Mark this reminder as handled"
                      title="Handled"
                    >
                      <Check />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyNote>Nothing saved for this week yet.</EmptyNote>
            )}
          </Card>

          <Card title="Set your goals for this week" eyebrow="Look ahead" count={weeklyGoals.length}>
            {weeklyGoals.length > 0 && (
              <ul className="rows">{weeklyGoals.map((goal) => <GoalRow key={goal.id} goal={goal} />)}</ul>
            )}
            <div className="goal-form">
              <input
                value={newGoalDraft}
                onChange={(event) => setNewGoalDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void addWeeklyGoal() }}
                placeholder="A goal for this week"
                aria-label="New goal for the week"
              />
              <label className="target-select">
                <span>Target</span>
                <select
                  value={newGoalTargetCount}
                  onChange={(event) => setNewGoalTargetCount(Number(event.target.value))}
                  aria-label="Target count"
                >
                  {TARGET_OPTIONS.map((option) => <option key={option} value={option}>{option}x</option>)}
                </select>
              </label>
              <button className="primary-button" disabled={!newGoalDraft.trim() || addingGoal} onClick={addWeeklyGoal}>
                {addingGoal ? <span className="button-spinner" /> : <Plus />} Add
              </button>
            </div>

            <div className="percy-inline">
              <p className="card-eyebrow"><Sparkles /> Or describe it in plain English</p>
              {percyGoalReply && <p className="alignment">{percyGoalReply}</p>}
              <div className="inline-form">
                <input
                  value={percyGoalQuery}
                  onChange={(event) => setPercyGoalQuery(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') void handlePercyCreateGoal() }}
                  placeholder="Gym every day this week, remind me 9-10am"
                  disabled={creatingPercyGoal}
                  aria-label="Describe a goal for Percy"
                />
                <button
                  className="ghost-button"
                  disabled={!percyGoalQuery.trim() || creatingPercyGoal}
                  onClick={() => void handlePercyCreateGoal()}
                >
                  {creatingPercyGoal ? <span className="button-spinner" /> : <Sparkles />} Set goal
                </button>
              </div>
            </div>
          </Card>

          <Card title="Review last week’s goals" eyebrow="Look back">
            {lastWeekGoals.length ? (
              <ul className="rows">
                {lastWeekGoals.map((goal) => <GoalRow key={goal.id} goal={goal} readOnly />)}
              </ul>
            ) : (
              <EmptyNote>No goals were set last week.</EmptyNote>
            )}
          </Card>

          <Card title="Your last seven days" eyebrow="Look back" count={weeklyWins.length}>
            {weeklyWins.length ? (
              <ul className="win-list">
                {weeklyWins.map((goal) => (
                  <li key={goal.id}><Check /> <span>{goal.goal_text}</span></li>
                ))}
              </ul>
            ) : (
              <EmptyNote>
                {weeklyEntries.length
                  ? `${weeklyEntries.length} ${weeklyEntries.length === 1 ? 'entry' : 'entries'} this week, nothing marked complete yet.`
                  : 'No entries yet this week.'}
              </EmptyNote>
            )}
          </Card>

          <Card title="What you’re working on" eyebrow="Day to day" count={visibleTasks.length}>
            {visibleTasks.length > 0 ? (
              <ul className="rows">{visibleTasks.map((task) => <TaskRow key={task.id} task={task} />)}</ul>
            ) : (
              <EmptyNote>Nothing here yet.</EmptyNote>
            )}
            <TaskForm />
          </Card>

          <div className="sheet-footer-bar">
            <button className="primary-button large" disabled={finishingWeeklyPlanning} onClick={finishWeeklySession}>
              {finishingWeeklyPlanning ? <span className="button-spinner" /> : <CircleCheck />} Finish weekly planning
            </button>
          </div>
        </>
      )}
    </Sheet>
  )
}
