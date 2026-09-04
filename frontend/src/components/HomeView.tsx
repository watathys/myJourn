import { useJournal } from '../state/journalContext'
import { CalendarAddCard } from './CalendarAddCard'
import { DayPanel } from './DayPanel'
import { GoalCard } from './GoalCard'
import { RemindersCard } from './RemindersCard'
import { TaskCard } from './TaskCard'

export function HomeView() {
  const { loading } = useJournal()

  if (loading) {
    return (
      <div className="home">
        <div className="skeleton skeleton-panel" />
        <div className="home-grid">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      </div>
    )
  }

  return (
    <div className="home">
      <DayPanel />
      <div className="home-grid">
        <div className="home-column">
          <TaskCard />
        </div>
        <div className="home-column">
          <GoalCard />
          <CalendarAddCard />
          <RemindersCard />
        </div>
      </div>
    </div>
  )
}
