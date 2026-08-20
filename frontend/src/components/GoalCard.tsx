import { CalendarRange, Plus, Target, X } from 'lucide-react'
import { formatWeekRange } from '../lib/day'
import { useJournal } from '../state/journalContext'
import { Card, EmptyNote } from './ui/Card'
import { GoalRow } from './GoalRow'

const TARGET_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 30, 50, 100]

export function GoalCard() {
  const {
    openGoals, weekStart, newGoalDraft, setNewGoalDraft, newGoalTargetCount, setNewGoalTargetCount,
    addingGoal, addWeeklyGoal, goalFormOpen, setGoalFormOpen, openPanel,
  } = useJournal()

  return (
    <Card
      title="This week’s goals"
      eyebrow={formatWeekRange(weekStart)}
      icon={<Target />}
      count={openGoals.length}
      actions={(
        <button
          className="text-button"
          onClick={() => setGoalFormOpen(!goalFormOpen)}
          aria-expanded={goalFormOpen}
        >
          {goalFormOpen ? <X /> : <Plus />} {goalFormOpen ? 'Close' : 'Add goal'}
        </button>
      )}
    >
      {goalFormOpen && (
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
      )}

      {openGoals.length > 0 ? (
        <ul className="rows">
          {openGoals.map((goal) => <GoalRow key={goal.id} goal={goal} />)}
        </ul>
      ) : (
        <EmptyNote>No goals set for this week yet.</EmptyNote>
      )}

      <button className="text-button card-foot-link" onClick={() => openPanel('weekly')}>
        <CalendarRange /> Open weekly planning
      </button>
    </Card>
  )
}
