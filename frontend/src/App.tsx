import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import {
  Archive, AlarmClock, Bell, BookOpen, Bookmark, CalendarDays, CalendarRange, Check, ChevronDown,
  ChevronRight, ChevronUp, CircleCheck, Compass, GripVertical, Lightbulb, Link2,
  LockKeyhole, LogOut, Menu, MessageCircle, Mic, Moon, PanelLeftClose, Pencil, PlayCircle, Plus, RotateCcw,
  Search, Send, Sparkles, SpellCheck, Sunrise, Trash2, Unlink, Upload, User as UserIcon, X,
} from 'lucide-react'
import {
  WorkingOnIllustration,
  WeeklyGoalsIllustration,
  RemindersIllustration,
  ReviewLastWeekIllustration,
  SevenDaysWinsIllustration,
  WeeklyReflectionIllustration,
} from './Illustrations'
import {
  acknowledgeTaskSnooze, chatWithPercy, createGoalWithPercy, createPercyReminder, createSavedPercyAdvice,
  createSpellingCorrection, createTask, createWeeklyGoal, deleteJournalEntry,
  deletePercyReminder, deleteSavedPercyAdvice, deleteSpellingCorrection, disconnectGoogle, dismissLifeInsight,
  dismissPercyReminder, finishWeeklyPlanning, generateWeeklyReflection, getDailyPlan,
  getEntries, getGoogleAuthorizeUrl, getGoogleStatus, getLifeInsights, getNorthStar, getPercyReminders,
  getSavedPercyAdvice, getSpellingCorrections, getTasks, getWeeklyGoals, getWeeklyPlanningSession,
  markLifeInsightRead, processEntry, reorderGoals, reorderTasks, saveDailyPlan, saveNorthStar,
  startWeeklyPlanning, updateGoal, updateJournalEntry, updateTask, type DailyPlan, type Goal,
  type GoalUpdate, type GoogleStatus, type JournalEntry, type LifeInsight,
  type PercyChatMessage, type PercyReminder, type SavedPercyAdvice, type SpellingCorrection, type Task,
  type WeeklyPlanningSession,
} from './api'
import { supabase } from './supabase'
import { Auth } from './Auth'
import './App.css'

const DRAFT_KEY = 'myjourn_entry_draft'
const DRAFT_DATE_KEY = 'myjourn_entry_date'
const VERBATIM_KEY = 'myjourn_save_verbatim'
const MOBILE_BREAKPOINT = '(max-width: 850px)'
const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

function isMobileViewport() {
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_BREAKPOINT).matches
}

function makeRowId() {
  return Math.random().toString(36).slice(2)
}

type ImportRow = { id: string; date: string; text: string }

function parseDateHeader(line: string): string | null {
  const clean = line.trim().replace(/^#{1,6}\s*/, '').replace(/^[-*]\s*/, '').replace(/:$/, '').trim()
  if (!clean) return null

  const iso = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const slash = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
  if (slash) {
    const [, month, day, rawYear] = slash
    const year = rawYear.length === 2 ? String(Number(rawYear) < 70 ? 2000 + Number(rawYear) : 1900 + Number(rawYear)) : rawYear
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  const long = clean.match(/^(?:[A-Za-z]+,\s*)?([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/)
  if (long) {
    const monthIndex = MONTH_NAMES.indexOf(long[1].toLowerCase())
    if (monthIndex !== -1) {
      return `${long[3]}-${String(monthIndex + 1).padStart(2, '0')}-${long[2].padStart(2, '0')}`
    }
  }

  return null
}

function parseBulkEntries(bulkText: string): ImportRow[] {
  const lines = bulkText.split('\n')
  const rows: ImportRow[] = []
  let currentDate: string | null = null
  let buffer: string[] = []

  function flush() {
    const text = buffer.join('\n').trim()
    if (currentDate && text) rows.push({ id: makeRowId(), date: currentDate, text })
    buffer = []
  }

  for (const line of lines) {
    const headerDate = parseDateHeader(line)
    if (headerDate) {
      flush()
      currentDate = headerDate
    } else {
      buffer.push(line)
    }
  }
  flush()

  return rows
}

function compareEntries(a: JournalEntry, b: JournalEntry) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1
  const aCreated = a.created_at ?? ''
  const bCreated = b.created_at ?? ''
  if (aCreated === bCreated) return 0
  return aCreated < bCreated ? 1 : -1
}

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: (event: {
    resultIndex: number
    results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
  }) => void
  onend: () => void
  start: () => void
  stop: () => void
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function today() {
  return toIsoDate(new Date())
}

const EVENING_START_HOUR = 18

function isEveningHours(now = new Date()) {
  return now.getHours() >= EVENING_START_HOUR
}

function tomorrow() {
  return addDaysToIsoDate(today(), 1)
}

function sortWorkingTasks(list: Task[]) {
  return [...list]
    .filter((task) => task.status !== 'abandoned')
    .sort((a, b) => {
      const aDone = a.status === 'completed' ? 1 : 0
      const bDone = b.status === 'completed' ? 1 : 0
      return aDone - bDone
    })
}

/** The Monday (as YYYY-MM-DD) of the week containing `isoDate` (defaults to today). */
function weekStartOf(isoDate?: string) {
  const base = isoDate ? new Date(`${isoDate}T12:00:00`) : new Date()
  const day = base.getDay() // 0 = Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day
  base.setDate(base.getDate() + diffToMonday)
  return toIsoDate(base)
}

function addDaysToIsoDate(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00`)
  date.setDate(date.getDate() + days)
  return toIsoDate(date)
}

function weekAgo() {
  const date = new Date()
  date.setDate(date.getDate() - 7)
  return toIsoDate(date)
}

function formatDate(date: string, long = false) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: long ? 'long' : 'short',
    month: 'long',
    day: 'numeric',
    year: long ? 'numeric' : undefined,
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`))
}

function formatWeekRange(weekStartIso: string) {
  const end = addDaysToIsoDate(weekStartIso, 6)
  const startLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${weekStartIso}T12:00:00Z`))
  const endLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${end}T12:00:00Z`))
  return `${startLabel} \u2013 ${endLabel}`
}

/** Splits a "remind_at" ISO datetime (naive-local, stored with a Z suffix) into
 * separate <input type="date"> / <input type="time"> values without any timezone shift. */
function splitRemindAt(remindAt: string | null): { date: string; time: string } {
  if (!remindAt) return { date: tomorrow(), time: '09:00' }
  const match = remindAt.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
  return match ? { date: match[1], time: match[2] } : { date: tomorrow(), time: '09:00' }
}

function combineToRemindAt(date: string, time: string): string {
  return `${date}T${time || '09:00'}:00Z`
}

function formatRemindAt(remindAt: string) {
  const { date, time } = splitRemindAt(remindAt)
  if (!date) return ''
  const [hourStr, minuteStr] = time.split(':')
  const hour = Number(hourStr)
  const displayHour = ((hour + 11) % 12) + 1
  const suffix = hour >= 12 ? 'PM' : 'AM'
  return `${formatDate(date)} \u00b7 ${displayHour}:${minuteStr} ${suffix}`
}

function entryTitle(entry: JournalEntry) {
  const source = entry.formatted_narrative || entry.raw_transcript
  return source.split(/\n|[.!?]\s/)[0].replace(/^#+\s*/, '').trim().slice(0, 46) || 'Untitled entry'
}

function Narrative({ text }: { text: string }) {
  return (
    <div className="narrative">
      {text.split(/\n{2,}/).filter(Boolean).map((paragraph, index) => {
        const clean = paragraph.replace(/^#+\s*/, '')
        if (/^#{1,3}\s/.test(paragraph)) return <h2 key={index}>{clean}</h2>
        if (paragraph.split('\n').every((line) => /^[-*]\s/.test(line))) {
          return <ul key={index}>{paragraph.split('\n').map((line) => <li key={line}>{line.replace(/^[-*]\s/, '')}</li>)}</ul>
        }
        return <p key={index}>{clean}</p>
      })}
    </div>
  )
}

function GoalCheckboxes({
  targetCount,
  currentCount,
  disabled,
  onChange,
}: {
  targetCount: number
  currentCount: number
  disabled?: boolean
  onChange: (newCount: number) => void
}) {
  if (targetCount <= 1) {
    const isCompleted = currentCount >= 1
    return (
      <button
        className="goal-check"
        disabled={disabled}
        onClick={() => onChange(isCompleted ? 0 : 1)}
        aria-label={isCompleted ? 'Mark incomplete' : 'Mark complete'}
        aria-pressed={isCompleted}
      >
        {isCompleted && <Check />}
      </button>
    )
  }

  return (
    <div className="goal-checkbox-group">
      {Array.from({ length: targetCount }, (_, idx) => {
        const step = idx + 1
        const isChecked = step <= currentCount
        return (
          <button
            key={step}
            type="button"
            className={`goal-multi-check ${isChecked ? 'checked' : ''}`}
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation()
              if (isChecked && step === currentCount) {
                onChange(step - 1)
              } else {
                onChange(step)
              }
            }}
            title={`Check ${step} of ${targetCount}`}
            aria-label={`Check step ${step} of ${targetCount}`}
          >
            {isChecked && <Check />}
          </button>
        )
      })}
      <span className="goal-count-badge">{currentCount}/{targetCount}</span>
    </div>
  )
}

function AlignmentSummary({ text }: { text: string }) {
  const summary = text
    .replace(/^\s*(?:#{1,3}\s*)?What I(?:'|’)m Working On\s*:?\s*/i, '')
    .trim()
  return summary ? <p className="alignment">{summary}</p> : null
}

type ScheduleModalState = {
  item: Task | Goal
  targetType: 'task' | 'goal'
  mode: 'reminder' | 'snooze'
}

function ScheduleModal({
  state, onClose, onSave, onClear, saving, googleConnected, onConnectGoogle, connectingGoogle,
}: {
  state: ScheduleModalState
  onClose: () => void
  onSave: (date: string, time: string) => void
  onClear: (() => void) | null
  saving: boolean
  googleConnected: boolean
  onConnectGoogle: () => void
  connectingGoogle: boolean
}) {
  const initial = state.mode === 'snooze'
    ? splitRemindAt(state.item.remind_at ?? (state.item.snoozed_until ? `${state.item.snoozed_until}T09:00:00Z` : null))
    : splitRemindAt(state.item.remind_at ?? null)
  const [date, setDate] = useState(initial.date)
  const [time, setTime] = useState(initial.time)
  const isReminder = state.mode === 'reminder'

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-icon">{isReminder ? <Bell /> : <AlarmClock />}</span>
          <div>
            <h2>{isReminder ? 'Schedule a reminder' : 'Remind me later'}</h2>
            <p>
              {isReminder
                ? `When should this show up on your calendar for "${state.item.goal_text}"?`
                : `Hide "${state.item.goal_text}" until this date. It'll come back highlighted, and remind you then too.`}
            </p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        {isReminder && !googleConnected && (
          <div className="modal-calendar-notice">
            <p>Connect Google Calendar so this reminder appears on your calendar with a notification.</p>
            <button className="primary-button" disabled={connectingGoogle} onClick={onConnectGoogle}>
              {connectingGoogle ? <span className="button-spinner" /> : <Link2 />} Connect Google Calendar
            </button>
          </div>
        )}
        <div className="modal-fields">
          <label>
            <span>Date</span>
            <input type="date" value={date} min={today()} onChange={(event) => setDate(event.target.value)} autoFocus />
          </label>
          <label>
            <span>Time</span>
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
          </label>
        </div>
        <div className="modal-actions">
          {onClear && (
            <button className="ghost-button" disabled={saving} onClick={onClear}>
              {isReminder ? 'Remove reminder' : 'Unsnooze'}
            </button>
          )}
          <button
            className="primary-button"
            disabled={saving || !date}
            onClick={() => onSave(date, time)}
          >
            {saving ? <span className="button-spinner" /> : <Check />}
            {isReminder && googleConnected ? 'Add to calendar' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function App() {
  const [view, setView] = useState<'journal' | 'northstar' | 'import' | 'weekly'>('journal')
  const [userId, setUserId] = useState('')
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [activeEntry, setActiveEntry] = useState<JournalEntry | null>(null)
  const [composingNewEntry, setComposingNewEntry] = useState(false)
  const [draft, setDraft] = useState(() => localStorage.getItem(DRAFT_KEY) ?? '')
  const [entryDate, setEntryDate] = useState(
    () => (
      localStorage.getItem(DRAFT_KEY)
        ? localStorage.getItem(DRAFT_DATE_KEY) ?? today()
        : today()
    ),
  )
  const [saveVerbatim, setSaveVerbatim] = useState(
    () => localStorage.getItem(VERBATIM_KEY) !== '0',
  )
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(() => !isMobileViewport())
  const [listening, setListening] = useState(false)
  const [northStar, setNorthStar] = useState('')
  const [savedNorthStar, setSavedNorthStar] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)
  const [editingNarrative, setEditingNarrative] = useState(false)
  const [narrativeDraft, setNarrativeDraft] = useState('')
  const [savingNarrative, setSavingNarrative] = useState(false)
  const [editingDate, setEditingDate] = useState(false)
  const [dateDraft, setDateDraft] = useState('')
  const [savingDate, setSavingDate] = useState(false)
  const [importRows, setImportRows] = useState<ImportRow[]>([{ id: makeRowId(), date: '', text: '' }])
  const [importBulkText, setImportBulkText] = useState('')
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null)
  const [lifeInsights, setLifeInsights] = useState<LifeInsight[]>([])
  const [percyReminders, setPercyReminders] = useState<PercyReminder[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [weeklyGoals, setWeeklyGoals] = useState<Goal[]>([])
  const [lastWeekGoals, setLastWeekGoals] = useState<Goal[]>([])
  const [weeklySession, setWeeklySession] = useState<WeeklyPlanningSession | null>(null)
  const [weeklySessionChecked, setWeeklySessionChecked] = useState(false)
  const [startingWeeklyPlanning, setStartingWeeklyPlanning] = useState(false)
  const [generatingReflection, setGeneratingReflection] = useState(false)
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null)
  const [connectingGoogle, setConnectingGoogle] = useState(false)
  const [googleNotice, setGoogleNotice] = useState('')
  const [weeklyLoading, setWeeklyLoading] = useState(false)
  const [dismissingReminderId, setDismissingReminderId] = useState<string | null>(null)
  const [newGoalDraft, setNewGoalDraft] = useState('')
  const [newGoalTargetCount, setNewGoalTargetCount] = useState<number>(1)
  const [addingGoal, setAddingGoal] = useState(false)
  const [newTaskDraft, setNewTaskDraft] = useState('')
  const [addingTask, setAddingTask] = useState(false)
  const [snoozedOpen, setSnoozedOpen] = useState(false)
  const [northStarOpen, setNorthStarOpen] = useState(true)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [spellingOpen, setSpellingOpen] = useState(false)
  const [insightsOpen, setInsightsOpen] = useState(true)
  const [chatMessages, setChatMessages] = useState<PercyChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [savedPercyAdvice, setSavedPercyAdvice] = useState<SavedPercyAdvice[]>([])
  const [savingAdviceIndex, setSavingAdviceIndex] = useState<number | null>(null)
  const [deletingAdviceId, setDeletingAdviceId] = useState<string | null>(null)
  const [activeChatInsight, setActiveChatInsight] = useState<{ id?: string; text: string } | null>(null)
  const [updatingGoalId, setUpdatingGoalId] = useState<string | null>(null)
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null)
  const [editGoalText, setEditGoalText] = useState('')
  const [editGoalTarget, setEditGoalTarget] = useState(1)
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null)
  const [scheduleModal, setScheduleModal] = useState<ScheduleModalState | null>(null)
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null)
  const [draggedGoalId, setDraggedGoalId] = useState<string | null>(null)
  const [goalDropTarget, setGoalDropTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null)
  const [percyGoalQuery, setPercyGoalQuery] = useState('')
  const [creatingPercyGoal, setCreatingPercyGoal] = useState(false)
  const [percyGoalReply, setPercyGoalReply] = useState('')
  const [deletingEntry, setDeletingEntry] = useState(false)
  const [appendTarget, setAppendTarget] = useState<{ id: string; date: string } | null>(null)
  const [spellingCorrections, setSpellingCorrections] = useState<SpellingCorrection[]>([])
  const [newIncorrectDraft, setNewIncorrectDraft] = useState('')
  const [newCorrectDraft, setNewCorrectDraft] = useState('')
  const [addingCorrection, setAddingCorrection] = useState(false)
  const [deletingCorrectionId, setDeletingCorrectionId] = useState<string | null>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const entryListRef = useRef<HTMLDivElement>(null)
  const percyChatRef = useRef<HTMLDivElement>(null)
  const percyInputRef = useRef<HTMLInputElement>(null)
  const speechRef = useRef<SpeechRecognitionLike | null>(null)

  const [workingOnOpen, setWorkingOnOpen] = useState(true)
  const [weeklyGoalsOpen, setWeeklyGoalsOpen] = useState(true)
  const [nextWeekRemindersOpen, setNextWeekRemindersOpen] = useState(true)
  const [newNextWeekReminderDraft, setNewNextWeekReminderDraft] = useState('')
  const [addingNextWeekReminder, setAddingNextWeekReminder] = useState(false)
  const [finishingWeeklyPlanning, setFinishingWeeklyPlanning] = useState(false)

  const [dailyPlan, setDailyPlan] = useState<DailyPlan | null>(null)
  const [morningSelectedIds, setMorningSelectedIds] = useState<string[]>([])
  const [savingMorningPlan, setSavingMorningPlan] = useState(false)
  const [eveningMode, setEveningMode] = useState(false)
  const [clockMs, setClockMs] = useState(() => Date.now())
  const [showAllTasks, setShowAllTasks] = useState(false)

  const [sessionUser, setSessionUser] = useState<{ id: string; email?: string } | null>(null)
  const [authChecking, setAuthChecking] = useState(true)
  const lastLoadedUserIdRef = useRef<string | null>(null)

  const loadUserData = async (id: string, force = false) => {
    if (!force && lastLoadedUserIdRef.current === id) return
    lastLoadedUserIdRef.current = id
    setLoading(true)
    try {
      const [history, mission, insights, taskList, goals, corrections, reminders, plan, savedAdvice] = await Promise.all([
        getEntries(id), getNorthStar(id), getLifeInsights(id), getTasks(id),
        getWeeklyGoals(id, weekStartOf()), getSpellingCorrections(id), getPercyReminders(id),
        getDailyPlan(id, today()), getSavedPercyAdvice(id),
      ])
      setUserId(id)
      setEntries(history)
      setNorthStar(mission)
      setSavedNorthStar(mission)
      setLifeInsights(insights)
      setTasks(taskList)
      setWeeklyGoals(goals)
      setSpellingCorrections(corrections)
      setPercyReminders(reminders)
      setDailyPlan(plan)
      setSavedPercyAdvice(savedAdvice)
      setMorningSelectedIds(plan?.selected_task_ids ?? [])
      getGoogleStatus(id).then(setGoogleStatus).catch(() => {})
    } catch (reason: unknown) {
      setError((reason as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return
      if (session?.user) {
        setSessionUser({ id: session.user.id, email: session.user.email })
        loadUserData(session.user.id)
      } else {
        setSessionUser(null)
      }
      setAuthChecking(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      if (session?.user) {
        setSessionUser({ id: session.user.id, email: session.user.email })
        loadUserData(session.user.id)
      } else {
        setSessionUser(null)
        setUserId('')
        lastLoadedUserIdRef.current = null
      }
      setAuthChecking(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const connected = params.get('google')
    const googleError = params.get('google_error')
    if (connected || googleError) {
      setGoogleNotice(
        connected
          ? 'Google Calendar connected. Scheduled reminders will now appear on your calendar.'
          : 'Could not connect Google Calendar. Please try again.',
      )
      params.delete('google')
      params.delete('google_error')
      const rest = params.toString()
      window.history.replaceState({}, '', rest ? `${window.location.pathname}?${rest}` : window.location.pathname)
    }
  }, [])

  const unreadInsightCount = useMemo(
    () => lifeInsights.filter((insight) => !insight.is_read).length,
    [lifeInsights],
  )

  useEffect(() => {
    // Marking insights read is a quiet side effect of viewing this page; failures are non-fatal.
    if (view !== 'northstar' || !userId || unreadInsightCount === 0) return
    const unread = lifeInsights.filter((insight) => !insight.is_read)
    setLifeInsights((current) => current.map((insight) => ({ ...insight, is_read: true })))
    Promise.all(unread.map((insight) => markLifeInsightRead(userId, insight.id))).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, userId])

  useEffect(() => {
    if (view !== 'weekly' || !userId) return
    let mounted = true
    setWeeklyLoading(true)
    setWeeklySessionChecked(false)
    getWeeklyPlanningSession(userId, weekStartOf())
      .then((existingSession) => {
        if (!mounted) return
        setWeeklySession(existingSession)
        setWeeklySessionChecked(true)
        if (!existingSession) return
        return Promise.all([
          getPercyReminders(userId),
          getTasks(userId),
          getWeeklyGoals(userId, weekStartOf()),
          getWeeklyGoals(userId, weekStartOf(addDaysToIsoDate(weekStartOf(), -7))),
        ]).then(([reminders, taskList, goals, lastWeek]) => {
          if (!mounted) return
          setPercyReminders(reminders)
          setTasks(taskList)
          setWeeklyGoals(goals)
          setLastWeekGoals(lastWeek)
        })
      })
      .catch((reason: Error) => mounted && setError(reason.message))
      .finally(() => mounted && setWeeklyLoading(false))
    return () => { mounted = false }
  }, [view, userId])

  useEffect(() => {
    if (draft) {
      localStorage.setItem(DRAFT_KEY, draft)
      localStorage.setItem(DRAFT_DATE_KEY, entryDate)
    } else {
      localStorage.removeItem(DRAFT_KEY)
      localStorage.removeItem(DRAFT_DATE_KEY)
    }
  }, [draft, entryDate])

  useEffect(() => {
    localStorage.setItem(VERBATIM_KEY, saveVerbatim ? '1' : '0')
  }, [saveVerbatim])

  useEffect(() => {
    if (!activeEntry) return
    requestAnimationFrame(() => {
      entryListRef.current
        ?.querySelector<HTMLElement>(`[data-entry-id="${activeEntry.id}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }, [activeEntry, entries])

  const filteredEntries = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return entries
    return entries.filter((entry) =>
      `${entry.raw_transcript} ${entry.formatted_narrative} ${entry.date}`.toLowerCase().includes(term),
    )
  }, [entries, search])

  const weeklyEntries = useMemo(() => {
    const cutoff = weekAgo()
    return entries.filter((entry) => entry.date >= cutoff)
  }, [entries])

  const weeklyWins = useMemo(() => {
    const seen = new Set<string>()
    const wins: Task[] = []
    for (const entry of weeklyEntries) {
      for (const goal of entry.completed_goals ?? []) {
        if (seen.has(goal.id)) continue
        seen.add(goal.id)
        wins.push(goal)
      }
    }
    return wins
  }, [weeklyEntries])

  const weeklyEntryCount = weeklyEntries.length

  const visibleTasks = useMemo(
    () => sortWorkingTasks(tasks.filter((task) => !task.is_snoozed)),
    [tasks],
  )
  const snoozedTasks = useMemo(
    () => tasks.filter((task) => task.is_snoozed && task.status !== 'abandoned'),
    [tasks],
  )
  const journalGoals = useMemo(
    () => weeklyGoals.filter((goal) => goal.status === 'pending'),
    [weeklyGoals],
  )
  const showJournalDashboard = useMemo(() => {
    if (!activeEntry) return true
    return activeEntry.date >= addDaysToIsoDate(today(), -1)
  }, [activeEntry])

  const todayEntry = useMemo(
    () => entries.find((entry) => entry.date === today()) ?? null,
    [entries],
  )

  const plannedTasks = useMemo(() => {
    if (!dailyPlan?.selected_task_ids.length) return []
    const byId = new Map(tasks.map((task) => [task.id, task]))
    return dailyPlan.selected_task_ids
      .map((id) => byId.get(id))
      .filter((task): task is Task => task !== undefined && task.status === 'pending')
  }, [dailyPlan, tasks])

  const bookendScreen = useMemo((): 'morning' | 'day' | 'evening' | null => {
    if (view !== 'journal') return null
    if (activeEntry) return null
    if (appendTarget) return null
    if (entryDate !== today()) return null
    if (todayEntry) return null
    if (isEveningHours(new Date(clockMs)) || eveningMode) return 'evening'
    if (!dailyPlan?.morning_completed_at) return 'morning'
    return 'day'
  }, [view, activeEntry, appendTarget, entryDate, todayEntry, dailyPlan, eveningMode, clockMs])

  function toggleMorningTask(taskId: string) {
    setMorningSelectedIds((current) =>
      current.includes(taskId)
        ? current.filter((id) => id !== taskId)
        : [...current, taskId],
    )
  }

  async function startMorningDay() {
    if (!userId || savingMorningPlan) return
    setSavingMorningPlan(true)
    setError('')
    try {
      const plan = await saveDailyPlan(userId, today(), morningSelectedIds, true)
      setDailyPlan(plan)
      setEveningMode(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save your plan for today.')
    } finally {
      setSavingMorningPlan(false)
    }
  }

  async function skipMorningPlanning() {
    if (!userId || savingMorningPlan) return
    setSavingMorningPlan(true)
    setError('')
    try {
      const plan = await saveDailyPlan(userId, today(), [], true)
      setDailyPlan(plan)
      setEveningMode(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to skip morning planning.')
    } finally {
      setSavingMorningPlan(false)
    }
  }

  function beginEvening() {
    setEveningMode(true)
    setDraft('')
    requestAnimationFrame(() => editorRef.current?.focus())
  }

  useEffect(() => {
    if (view !== 'journal' || activeEntry || appendTarget || loading || composingNewEntry) return
    if (todayEntry && entryDate === today()) {
      setActiveEntry(todayEntry)
      setNarrativeDraft(todayEntry.formatted_narrative)
    }
  }, [view, activeEntry, appendTarget, loading, todayEntry, entryDate, composingNewEntry])

  useEffect(() => {
    const tick = () => setClockMs(Date.now())
    const interval = window.setInterval(tick, 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  function toggleSidebar() {
    setSidebarOpen((current) => !current)
  }

  function startNewEntry(prefill = '') {
    setView('journal')
    setActiveEntry(null)
    setComposingNewEntry(true)
    setEditingNarrative(false)
    setNarrativeDraft('')
    setEditingDate(false)
    setDraft(prefill)
    setEntryDate(today())
    setAppendTarget(null)
    setEveningMode(false)
    setError('')
    if (isMobileViewport()) setSidebarOpen(false)
    requestAnimationFrame(() => {
      document.querySelector(`[data-entry-date="${today()}"]`)?.scrollIntoView({
        behavior: 'smooth', block: 'center',
      })
      editorRef.current?.focus()
    })
  }

  function continueThread(entry: JournalEntry, question: string) {
    startNewEntry(`${question}\n\n`)
    setEntryDate(entry.date)
    setAppendTarget({ id: entry.id, date: entry.date })
  }

  function openEntry(entry: JournalEntry) {
    setActiveEntry(entry)
    setComposingNewEntry(false)
    setEditingNarrative(false)
    setNarrativeDraft(entry.formatted_narrative)
    setEditingDate(false)
    setView('journal')
    if (isMobileViewport()) setSidebarOpen(false)
  }

  function beginNarrativeEdit() {
    if (!activeEntry) return
    setNarrativeDraft(activeEntry.formatted_narrative)
    setEditingNarrative(true)
    setError('')
  }

  function cancelNarrativeEdit() {
    setEditingNarrative(false)
    setNarrativeDraft(activeEntry?.formatted_narrative ?? '')
  }

  async function saveNarrativeEdit() {
    if (!userId || !activeEntry || savingNarrative) return
    const clean = narrativeDraft.trim()
    if (!clean) {
      setError('Your reflection needs at least a little text.')
      return
    }
    setSavingNarrative(true)
    setError('')
    try {
      const updated = await updateJournalEntry(userId, activeEntry.id, { formatted_narrative: clean })
      const nextEntry = { ...activeEntry, formatted_narrative: updated.formatted_narrative }
      setActiveEntry(nextEntry)
      setEntries((current) =>
        current.map((entry) => (entry.id === nextEntry.id ? { ...entry, ...nextEntry } : entry)),
      )
      setEditingNarrative(false)
      setNarrativeDraft(updated.formatted_narrative)
      refreshSpellingCorrections()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save your edits.')
    } finally {
      setSavingNarrative(false)
    }
  }

  async function refreshSpellingCorrections() {
    if (!userId) return
    try {
      const corrections = await getSpellingCorrections(userId)
      setSpellingCorrections(corrections)
    } catch {
      // Quiet background refresh
    }
  }

  async function addSpellingCorrection() {
    const inc = newIncorrectDraft.trim()
    const cor = newCorrectDraft.trim()
    if (!userId || !inc || !cor || addingCorrection) return
    setAddingCorrection(true)
    setError('')
    try {
      const created = await createSpellingCorrection(userId, inc, cor)
      setSpellingCorrections((current) => {
        const filtered = current.filter((c) => c.incorrect_word.toLowerCase() !== inc.toLowerCase())
        return [created, ...filtered]
      })
      setNewIncorrectDraft('')
      setNewCorrectDraft('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save that spelling correction.')
    } finally {
      setAddingCorrection(false)
    }
  }

  async function removeSpellingCorrection(correctionId: string) {
    if (!userId || deletingCorrectionId) return
    setDeletingCorrectionId(correctionId)
    setError('')
    try {
      await deleteSpellingCorrection(userId, correctionId)
      setSpellingCorrections((current) => current.filter((c) => c.id !== correctionId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to remove that spelling correction.')
    } finally {
      setDeletingCorrectionId(null)
    }
  }

  function beginDateEdit() {
    if (!activeEntry) return
    setDateDraft(activeEntry.date)
    setEditingDate(true)
    setError('')
  }

  function cancelDateEdit() {
    setEditingDate(false)
    setDateDraft(activeEntry?.date ?? '')
  }

  async function saveDateEdit() {
    if (!userId || !activeEntry || savingDate || !dateDraft) return
    if (dateDraft === activeEntry.date) {
      setEditingDate(false)
      return
    }
    setSavingDate(true)
    setError('')
    try {
      const updated = await updateJournalEntry(userId, activeEntry.id, { date: dateDraft })
      const nextEntry = { ...activeEntry, date: updated.date }
      setActiveEntry(nextEntry)
      setEntries((current) =>
        current
          .map((entry) => (entry.id === nextEntry.id ? { ...entry, ...nextEntry } : entry))
          .sort(compareEntries),
      )
      setEditingDate(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to change the date.')
    } finally {
      setSavingDate(false)
    }
  }

  function addImportRow() {
    setImportRows((current) => [...current, { id: makeRowId(), date: '', text: '' }])
  }

  function removeImportRow(id: string) {
    setImportRows((current) => (current.length > 1 ? current.filter((row) => row.id !== id) : current))
  }

  function updateImportRow(id: string, field: 'date' | 'text', value: string) {
    setImportRows((current) =>
      current.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    )
  }

  function parseBulkImport() {
    const parsed = parseBulkEntries(importBulkText)
    if (!parsed.length) {
      setError('We couldn’t find any dated entries in that text. Start each entry with its date on its own line, like 2024-01-15.')
      return
    }
    setImportRows((current) => {
      const blankOnly = current.length === 1 && !current[0].date && !current[0].text.trim()
      return blankOnly ? parsed : [...current, ...parsed]
    })
    setImportBulkText('')
    setError('')
  }

  async function startImport() {
    const readyRows = importRows.filter((row) => row.date && row.text.trim())
    if (!readyRows.length || !userId || importing) {
      if (!readyRows.length) setError('Add at least one entry with a date and some text.')
      return
    }
    const ordered = [...readyRows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    setImporting(true)
    setError('')
    setImportProgress({ done: 0, total: ordered.length })
    const importedIds = new Set<string>()
    let lastImported: JournalEntry | null = null
    try {
      for (const row of ordered) {
        lastImported = await processEntry(userId, row.date, row.text.trim(), true)
        importedIds.add(row.id)
        setImportProgress((current) => (current ? { ...current, done: current.done + 1 } : current))
      }
      const refreshed = await getEntries(userId)
      setEntries(refreshed)
      setImportRows([{ id: makeRowId(), date: '', text: '' }])
      const reopened = refreshed.find((entry) => entry.id === lastImported?.id) ?? null
      setActiveEntry(reopened)
      setNarrativeDraft(reopened?.formatted_narrative ?? '')
      setEditingNarrative(false)
      setEditingDate(false)
      setView('journal')
      refreshBackgroundState()
    } catch (reason) {
      setImportRows((current) => current.filter((row) => !importedIds.has(row.id)))
      setError(
        reason instanceof Error
          ? `Import stopped: ${reason.message} Entries before this one were saved.`
          : 'Something interrupted the import. Entries before this one were saved.',
      )
    } finally {
      setImporting(false)
      setImportProgress(null)
    }
  }

  async function submitEntry() {
    if (!draft.trim() || !userId || generating) return
    setGenerating(true)
    setError('')
    try {
      const created = await processEntry(
        userId,
        entryDate,
        draft.trim(),
        false,
        appendTarget?.id,
        saveVerbatim,
      )
      const [refreshedEntries, refreshedTasks] = await Promise.all([
        getEntries(userId),
        getTasks(userId),
      ])
      const savedEntry = refreshedEntries.find((entry) => entry.id === created.id) ?? created
      setEntries(refreshedEntries)
      setTasks(refreshedTasks)
      setActiveEntry(savedEntry)
      setComposingNewEntry(false)
      setNarrativeDraft(savedEntry.formatted_narrative)
      setEditingNarrative(false)
      setDraft('')
      setAppendTarget(null)
      setEveningMode(false)
      refreshBackgroundState()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create your entry.')
    } finally {
      setGenerating(false)
    }
  }

  function toggleVoice() {
    if (listening) {
      speechRef.current?.stop()
      setListening(false)
      return
    }
    const speechWindow = window as typeof window & {
      SpeechRecognition?: new () => SpeechRecognitionLike
      webkitSpeechRecognition?: new () => SpeechRecognitionLike
    }
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition
    if (!Recognition) {
      setError('Voice input is not supported in this browser.')
      return
    }
    const recognition = new Recognition()
    recognition.continuous = true
    recognition.interimResults = false
    recognition.lang = 'en-US'
    recognition.onresult = (event) => {
      let words = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) words += event.results[i][0].transcript
      }
      if (words) setDraft((current) => `${current}${current ? ' ' : ''}${words.trim()}`)
    }
    recognition.onend = () => setListening(false)
    speechRef.current = recognition
    recognition.start()
    setListening(true)
  }

  async function updateNorthStar() {
    if (!userId || savingSettings) return
    setSavingSettings(true)
    setError('')
    try {
      const clean = northStar.trim()
      await saveNorthStar(userId, clean)
      setNorthStar(clean)
      setSavedNorthStar(clean)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save your settings.')
    } finally {
      setSavingSettings(false)
    }
  }

  async function refreshBackgroundState() {
    if (!userId) return
    try {
      const [reminders, insights, goals, taskList] = await Promise.all([
        getPercyReminders(userId), getLifeInsights(userId), getWeeklyGoals(userId, weekStartOf()), getTasks(userId),
      ])
      setPercyReminders(reminders)
      setLifeInsights(insights)
      setWeeklyGoals(goals)
      setTasks(taskList)
    } catch {
      // Best-effort background refresh; the user can still see everything on next visit.
    }
  }

  async function dismissReminder(reminderId: string) {
    if (!userId || dismissingReminderId) return
    setDismissingReminderId(reminderId)
    try {
      await dismissPercyReminder(userId, reminderId)
      setPercyReminders((current) => current.filter((reminder) => reminder.id !== reminderId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to dismiss that reminder.')
    } finally {
      setDismissingReminderId(null)
    }
  }

  async function dismissInsight(insightId: string) {
    if (!userId) return
    try {
      await dismissLifeInsight(userId, insightId)
      setLifeInsights((current) => current.filter((insight) => insight.id !== insightId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to dismiss that insight.')
    }
  }

  function findContextQuestion(messageIndex: number): string | undefined {
    for (let i = messageIndex - 1; i >= 0; i -= 1) {
      if (chatMessages[i].role === 'user') return chatMessages[i].content
    }
    return undefined
  }

  function isAdviceSaved(adviceText: string): boolean {
    return savedPercyAdvice.some((item) => item.advice_text === adviceText)
  }

  async function savePercyAdvice(messageIndex: number) {
    if (!userId || savingAdviceIndex !== null) return
    const msg = chatMessages[messageIndex]
    if (!msg || msg.role !== 'assistant' || isAdviceSaved(msg.content)) return

    setSavingAdviceIndex(messageIndex)
    setError('')
    try {
      const saved = await createSavedPercyAdvice(
        userId,
        msg.content,
        findContextQuestion(messageIndex),
      )
      setSavedPercyAdvice((current) => [saved, ...current])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save that advice.')
    } finally {
      setSavingAdviceIndex(null)
    }
  }

  async function removeSavedAdvice(adviceId: string) {
    if (!userId) return
    setDeletingAdviceId(adviceId)
    setError('')
    try {
      await deleteSavedPercyAdvice(userId, adviceId)
      setSavedPercyAdvice((current) => current.filter((item) => item.id !== adviceId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to remove saved advice.')
    } finally {
      setDeletingAdviceId(null)
    }
  }

  async function addNextWeekReminder() {
    const clean = newNextWeekReminderDraft.trim()
    if (!userId || !clean || addingNextWeekReminder) return
    setAddingNextWeekReminder(true)
    setError('')
    try {
      const created = await createPercyReminder(userId, clean)
      setPercyReminders((current) => [...current, created])
      setNewNextWeekReminderDraft('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to add that reminder.')
    } finally {
      setAddingNextWeekReminder(false)
    }
  }

  async function removeNextWeekReminder(reminderId: string) {
    if (!userId) return
    try {
      await deletePercyReminder(userId, reminderId)
      setPercyReminders((current) => current.filter((r) => r.id !== reminderId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to delete that reminder.')
    }
  }

  async function addManualTask() {
    const clean = newTaskDraft.trim()
    if (!userId || !clean || addingTask) return
    setAddingTask(true)
    setError('')
    try {
      const task = await createTask(userId, clean)
      setTasks((current) => sortWorkingTasks([...current, task]))
      setNewTaskDraft('')
      refreshBackgroundState()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to add that task.')
    } finally {
      setAddingTask(false)
    }
  }

  function renderTaskInputRow() {
    return (
      <div className="goal-input-row task-input-row">
        <input
          value={newTaskDraft}
          onChange={(event) => setNewTaskDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') addManualTask() }}
          placeholder="e.g. remind me on thursday at 9am to drink a protein shake"
          aria-label="New task for What I'm Working On"
        />
        <button className="primary-button" disabled={!newTaskDraft.trim() || addingTask} onClick={addManualTask}>
          {addingTask ? <span className="button-spinner" /> : <Plus />} Add task
        </button>
      </div>
    )
  }

  async function addWeeklyGoal() {
    const clean = newGoalDraft.trim()
    if (!userId || !clean || addingGoal) return
    setAddingGoal(true)
    setError('')
    try {
      const goal = await createWeeklyGoal(userId, clean, weekStartOf(), newGoalTargetCount)
      setWeeklyGoals((current) => [...current, goal])
      setNewGoalDraft('')
      setNewGoalTargetCount(1)
      refreshBackgroundState()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to add that goal.')
    } finally {
      setAddingGoal(false)
    }
  }

  async function patchGoal(goal: Goal, updates: GoalUpdate): Promise<Goal | undefined> {
    if (!userId) return undefined
    setUpdatingGoalId(goal.id)
    setError('')
    try {
      const updated = await updateGoal(userId, goal.id, updates)
      setWeeklyGoals((current) => current.map((item) => (item.id === goal.id ? updated : item)))
      setLastWeekGoals((current) => current.map((item) => (item.id === goal.id ? updated : item)))
      return updated
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update goal.')
      return undefined
    } finally {
      setUpdatingGoalId(null)
    }
  }

  async function updateGoalProgress(goal: Goal, newCount: number) {
    if (!userId) return
    const target = goal.target_count ?? 1
    const current_count = Math.max(0, Math.min(target, newCount))
    const optimistic: Goal = {
      ...goal,
      current_count,
      status: current_count >= target ? 'completed' : 'pending',
    }
    const applyLocal = (next: Goal) => {
      const updateGoals = (goals: Goal[]) =>
        goals.map((item) => (item.id === goal.id ? next : item))
      setWeeklyGoals(updateGoals)
      setLastWeekGoals(updateGoals)
    }
    applyLocal(optimistic)
    setError('')
    try {
      const updated = await updateGoal(userId, goal.id, { current_count })
      applyLocal(updated)
    } catch (reason) {
      applyLocal(goal)
      setError(reason instanceof Error ? reason.message : 'Unable to update that goal.')
    }
  }

  async function changeGoalStatus(goal: Goal, status: Goal['status']) {
    if (!userId || updatingGoalId) return
    setUpdatingGoalId(goal.id)
    setError('')
    try {
      const updated = await updateGoal(userId, goal.id, status)
      const updateGoals = (goals: Goal[]) => (
        status === 'abandoned'
          ? goals.filter((item) => item.id !== goal.id)
          : goals.map((item) => (item.id === goal.id ? updated : item))
      )
      setWeeklyGoals(updateGoals)
      setLastWeekGoals(updateGoals)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update that goal.')
    } finally {
      setUpdatingGoalId(null)
    }
  }

  function startEditingGoal(goal: Goal) {
    setEditingGoalId(goal.id)
    setEditGoalText(goal.goal_text)
    setEditGoalTarget(goal.target_count ?? 1)
  }

  async function saveGoalEdit(goal: Goal) {
    const cleanText = editGoalText.trim()
    if (!userId || !cleanText) return
    const target = Math.min(1000, Math.max(1, Math.floor(editGoalTarget) || 1))
    setUpdatingGoalId(goal.id)
    setError('')
    try {
      const updated = await updateGoal(userId, goal.id, { goal_text: cleanText, target_count: target })
      const applyEdit = (goals: Goal[]) => goals.map((item) => (item.id === goal.id ? updated : item))
      setWeeklyGoals(applyEdit)
      setLastWeekGoals(applyEdit)
      setEditingGoalId(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update that goal.')
    } finally {
      setUpdatingGoalId(null)
    }
  }

  function clearGoalDrag() {
    setDraggedGoalId(null)
    setGoalDropTarget(null)
  }

  function handleGoalDragStart(event: DragEvent, goalId: string) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', goalId)
    setDraggedGoalId(goalId)
    setGoalDropTarget(null)
  }

  function handleGoalDragOver(event: DragEvent, goalId: string) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (!draggedGoalId || draggedGoalId === goalId) {
      setGoalDropTarget(null)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setGoalDropTarget((current) => (
      current?.id === goalId && current.position === position
        ? current
        : { id: goalId, position }
    ))
  }

  async function handleGoalDrop(targetId: string, position: 'before' | 'after') {
    if (!userId || !draggedGoalId) {
      clearGoalDrag()
      return
    }
    if (draggedGoalId === targetId) {
      clearGoalDrag()
      return
    }
    const order = weeklyGoals.map((goal) => goal.id)
    const fromIndex = order.indexOf(draggedGoalId)
    if (fromIndex === -1 || !order.includes(targetId)) {
      clearGoalDrag()
      return
    }
    order.splice(fromIndex, 1)
    let insertIndex = order.indexOf(targetId)
    if (position === 'after') insertIndex += 1
    order.splice(insertIndex, 0, draggedGoalId)
    clearGoalDrag()
    const byId = new Map(weeklyGoals.map((goal) => [goal.id, goal]))
    setWeeklyGoals((current) => {
      const reordered = order.map((id) => byId.get(id)).filter((goal): goal is Goal => Boolean(goal))
      const rest = current.filter((goal) => !order.includes(goal.id))
      return [...reordered, ...rest]
    })
    try {
      const updated = await reorderGoals(userId, weekStartOf(), order)
      setWeeklyGoals((current) => {
        const byUpdatedId = new Map(updated.map((goal) => [goal.id, goal]))
        return current.map((goal) => byUpdatedId.get(goal.id) ?? goal)
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to reorder your goals.')
    }
  }

  function renderGoal(goal: Goal, options: { readOnly?: boolean } = {}) {
    const isCompleted = goal.status === 'completed'
    const targetCount = goal.target_count ?? 1
    const currentCount = goal.current_count ?? (isCompleted ? targetCount : 0)

    if (options.readOnly) {
      return (
        <li className={`goal-${goal.status} goal-item`} key={goal.id}>
          <div className="goal-body">
            <p>{goal.goal_text}</p>
          </div>
          <GoalCheckboxes
            targetCount={targetCount}
            currentCount={currentCount}
            disabled={true}
            onChange={() => {}}
          />
        </li>
      )
    }

    if (editingGoalId === goal.id) {
      return (
        <li className="goal-item goal-editing" key={goal.id}>
          <div className="goal-edit-form">
            <input
              value={editGoalText}
              onChange={(event) => setEditGoalText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void saveGoalEdit(goal)
                if (event.key === 'Escape') setEditingGoalId(null)
              }}
              placeholder="Goal"
              aria-label="Goal text"
              autoFocus
            />
            <div className="goal-edit-target">
              <label htmlFor={`goal-edit-target-${goal.id}`}>Target</label>
              <input
                id={`goal-edit-target-${goal.id}`}
                type="number"
                min={1}
                max={1000}
                value={editGoalTarget}
                onChange={(event) => setEditGoalTarget(Number(event.target.value))}
                aria-label="Target count"
              />
              <span>x</span>
            </div>
            <div className="goal-edit-actions">
              <button
                className="icon-button"
                disabled={updatingGoalId === goal.id || !editGoalText.trim()}
                onClick={() => void saveGoalEdit(goal)}
                aria-label="Save goal"
                title="Save"
              >
                <Check />
              </button>
              <button
                className="icon-button"
                disabled={updatingGoalId === goal.id}
                onClick={() => setEditingGoalId(null)}
                aria-label="Cancel editing"
                title="Cancel"
              >
                <X />
              </button>
            </div>
          </div>
        </li>
      )
    }

    const classNames = [`goal-${goal.status}`, 'goal-item']
    if (isCompleted) classNames.push('goal-completed')
    if (goal.just_resurfaced) classNames.push('task-highlight')
    if (draggedGoalId === goal.id) classNames.push('is-dragging')
    if (goalDropTarget?.id === goal.id) classNames.push(`drop-${goalDropTarget.position}`)

    return (
      <li
        className={classNames.join(' ')}
        key={goal.id}
        draggable
        onDragStart={(event) => handleGoalDragStart(event, goal.id)}
        onDragOver={(event) => handleGoalDragOver(event, goal.id)}
        onDragEnd={clearGoalDrag}
        onDrop={() => {
          if (!goalDropTarget || goalDropTarget.id !== goal.id) return
          void handleGoalDrop(goal.id, goalDropTarget.position)
        }}
      >
        <span className="goal-drag-handle task-drag-handle" aria-hidden="true"><GripVertical /></span>
        <div className="goal-body task-body">
          <p>{goal.goal_text}</p>
          <div className="task-meta">
            {goal.remind_at && (
              <span className="task-badge">
                <Bell /> {formatRemindAt(goal.remind_at)}
                {goal.has_calendar_reminder && ' \u00b7 on your calendar'}
              </span>
            )}
            {goal.just_resurfaced && (
              <span className="task-badge task-badge-new">
                Back on your radar
              </span>
            )}
          </div>
        </div>
        <div className="goal-actions task-actions">
          <button
            className="icon-button"
            disabled={updatingGoalId === goal.id}
            onClick={() => startEditingGoal(goal)}
            aria-label={`Edit ${goal.goal_text}`}
            title="Edit goal"
          >
            <Pencil />
          </button>
          <button
            className="icon-button"
            disabled={updatingGoalId === goal.id}
            onClick={() => openScheduleModal(goal, 'goal')}
            aria-label={`Schedule a reminder for ${goal.goal_text}`}
            title="Schedule reminder"
          >
            <Bell />
          </button>
          {isCompleted && (
            <button
              className="goal-archive"
              disabled={updatingGoalId === goal.id}
              onClick={() => changeGoalStatus(goal, 'abandoned')}
              aria-label={`Archive ${goal.goal_text}`}
            >
              <Archive /> Archive
            </button>
          )}
        </div>
        <GoalCheckboxes
          targetCount={targetCount}
          currentCount={currentCount}
          onChange={(newCount) => updateGoalProgress(goal, newCount)}
        />
      </li>
    )
  }

  async function patchTask(task: Task, updates: Parameters<typeof updateTask>[2]): Promise<Task | undefined> {
    if (!userId) return undefined

    const updateKeys = Object.keys(updates)
    const isCountOnly = updateKeys.length === 1 && updateKeys[0] === 'current_count'
      && updates.current_count !== undefined

    if (isCountOnly) {
      const target = task.target_count ?? 1
      const current_count = Math.max(0, Math.min(target, updates.current_count!))
      const optimistic: Task = {
        ...task,
        current_count,
        status: current_count >= target ? 'completed' : 'pending',
      }
      setTasks((current) =>
        sortWorkingTasks(current.map((item) => (item.id === task.id ? optimistic : item))),
      )
      setError('')
      try {
        const updated = await updateTask(userId, task.id, { current_count })
        setTasks((current) =>
          sortWorkingTasks(current.map((item) => (item.id === task.id ? updated : item))),
        )
        return updated
      } catch (reason) {
        setTasks((current) =>
          sortWorkingTasks(current.map((item) => (item.id === task.id ? task : item))),
        )
        setError(reason instanceof Error ? reason.message : 'Unable to update that task.')
        return undefined
      }
    }

    setUpdatingTaskId(task.id)
    setError('')
    try {
      const updated = await updateTask(userId, task.id, updates)
      const archived = updated.status === 'abandoned'
      setTasks((current) => {
        if (archived) return current.filter((item) => item.id !== task.id)
        return sortWorkingTasks(current.map((item) => (item.id === task.id ? updated : item)))
      })
      const touchesJournalFields = 'status' in updates || 'remind_at' in updates || 'snoozed_until' in updates
      if (touchesJournalFields || archived) {
        setEntries((current) => current.map((entry) => ({
          ...entry,
          goals: archived
            ? entry.goals.filter((item) => item.id !== task.id)
            : entry.goals.map((item) => (item.id === task.id ? updated : item)),
          completed_goals: archived
            ? (entry.completed_goals ?? []).filter((item) => item.id !== task.id)
            : (entry.completed_goals ?? []).map((item) => (item.id === task.id ? updated : item)),
        })))
        setActiveEntry((current) => current ? {
          ...current,
          goals: archived
            ? current.goals.filter((item) => item.id !== task.id)
            : current.goals.map((item) => (item.id === task.id ? updated : item)),
          completed_goals: archived
            ? (current.completed_goals ?? []).filter((item) => item.id !== task.id)
            : (current.completed_goals ?? []).map((item) => (item.id === task.id ? updated : item)),
        } : current)
      }
      return updated
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update that task.')
      return undefined
    } finally {
      setUpdatingTaskId(null)
    }
  }

  async function acknowledgeHighlight(task: Task) {
    if (!userId) return
    try {
      const updated = await acknowledgeTaskSnooze(userId, task.id)
      setTasks((current) => current.map((item) => (item.id === task.id ? updated : item)))
    } catch {
      // Non-fatal: the highlight will clear next time the task list refreshes.
    }
  }

  function openScheduleModal(item: Task | Goal, targetType: 'task' | 'goal' = 'task') {
    setScheduleModal({ item, targetType, mode: 'reminder' })
  }

  function openSnoozeModal(item: Task | Goal, targetType: 'task' | 'goal' = 'task') {
    setScheduleModal({ item, targetType, mode: 'snooze' })
  }

  async function saveScheduleModal(date: string, time: string) {
    if (!scheduleModal) return
    setSavingSchedule(true)
    const remindAt = combineToRemindAt(date, time)
    const wantsCalendar = scheduleModal.mode === 'reminder'
    try {
      let updated: Task | Goal | undefined
      if (scheduleModal.targetType === 'task') {
        const task = scheduleModal.item as Task
        if (scheduleModal.mode === 'reminder') {
          updated = await patchTask(task, { remind_at: remindAt })
        } else {
          updated = await patchTask(task, { remind_at: remindAt, snoozed_until: date })
        }
      } else {
        const goal = scheduleModal.item as Goal
        if (scheduleModal.mode === 'reminder') {
          updated = await patchGoal(goal, { remind_at: remindAt })
        } else {
          updated = await patchGoal(goal, { remind_at: remindAt, snoozed_until: date })
        }
      }
      if (!updated) return
      if (wantsCalendar && updated.remind_at) {
        if (!googleStatus?.connected) {
          setGoogleNotice('Reminder saved — connect Google Calendar so it shows up with a notification.')
        } else if (!updated.has_calendar_reminder) {
          setError('Reminder saved, but it couldn’t be added to Google Calendar. Try disconnecting and reconnecting Google in Settings.')
        } else {
          setGoogleNotice('Added to your Google Calendar.')
        }
      }
      setScheduleModal(null)
    } finally {
      setSavingSchedule(false)
    }
  }

  async function clearScheduleModal() {
    if (!scheduleModal) return
    setSavingSchedule(true)
    try {
      if (scheduleModal.targetType === 'task') {
        const task = scheduleModal.item as Task
        if (scheduleModal.mode === 'reminder') {
          await patchTask(task, { remind_at: null })
        } else {
          await patchTask(task, { remind_at: null, snoozed_until: null })
        }
      } else {
        const goal = scheduleModal.item as Goal
        if (scheduleModal.mode === 'reminder') {
          await patchGoal(goal, { remind_at: null })
        } else {
          await patchGoal(goal, { remind_at: null, snoozed_until: null })
        }
      }
      setScheduleModal(null)
    } finally {
      setSavingSchedule(false)
    }
  }

  function clearTaskDrag() {
    setDraggedTaskId(null)
    setDropTarget(null)
  }

  function handleTaskDragStart(event: DragEvent, taskId: string) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', taskId)
    setDraggedTaskId(taskId)
    setDropTarget(null)
  }

  function handleTaskDragOver(event: DragEvent, taskId: string) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (!draggedTaskId || draggedTaskId === taskId) {
      setDropTarget(null)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setDropTarget((current) => (
      current?.id === taskId && current.position === position
        ? current
        : { id: taskId, position }
    ))
  }

  async function handleTaskDrop(targetId: string, position: 'before' | 'after') {
    if (!userId || !draggedTaskId) {
      clearTaskDrag()
      return
    }
    if (draggedTaskId === targetId) {
      clearTaskDrag()
      return
    }
    const order = visibleTasks.map((task) => task.id)
    const fromIndex = order.indexOf(draggedTaskId)
    if (fromIndex === -1 || !order.includes(targetId)) {
      clearTaskDrag()
      return
    }
    order.splice(fromIndex, 1)
    let insertIndex = order.indexOf(targetId)
    if (position === 'after') insertIndex += 1
    order.splice(insertIndex, 0, draggedTaskId)
    clearTaskDrag()
    const byId = new Map(tasks.map((task) => [task.id, task]))
    setTasks((current) => {
      const reordered = order.map((id) => byId.get(id)).filter((task): task is Task => Boolean(task))
      const rest = current.filter((task) => !order.includes(task.id))
      return [...reordered, ...rest]
    })
    try {
      const updated = await reorderTasks(userId, order)
      setTasks((current) => {
        const byUpdatedId = new Map(updated.map((task) => [task.id, task]))
        return current.map((task) => byUpdatedId.get(task.id) ?? task)
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to reorder your tasks.')
    }
  }

  function renderTask(task: Task) {
    const isCompleted = task.status === 'completed'
    const targetCount = task.target_count ?? 1
    const currentCount = task.current_count ?? (isCompleted ? targetCount : 0)

    const classNames = ['task-item']
    if (isCompleted) classNames.push('goal-completed')
    if (task.just_resurfaced) classNames.push('task-highlight')
    if (draggedTaskId === task.id) classNames.push('is-dragging')
    if (dropTarget?.id === task.id) classNames.push(`drop-${dropTarget.position}`)
    return (
      <li
        className={classNames.join(' ')}
        key={task.id}
        draggable
        onDragStart={(event) => handleTaskDragStart(event, task.id)}
        onDragOver={(event) => handleTaskDragOver(event, task.id)}
        onDragEnd={clearTaskDrag}
        onDrop={() => {
          if (!dropTarget || dropTarget.id !== task.id) return
          void handleTaskDrop(task.id, dropTarget.position)
        }}
      >
        <span className="task-drag-handle" aria-hidden="true"><GripVertical /></span>
        <GoalCheckboxes
          targetCount={targetCount}
          currentCount={currentCount}
          onChange={(newCount) => { void patchTask(task, { current_count: newCount }) }}
        />
        <div className="task-body">
          <p>{task.goal_text}</p>
          <div className="task-meta">
            {task.remind_at && (
              <span className="task-badge">
                <Bell /> {formatRemindAt(task.remind_at)}
                {task.has_calendar_reminder && ' \u00b7 on your calendar'}
              </span>
            )}
            {task.just_resurfaced && (
              <button className="task-badge task-badge-new" onClick={() => acknowledgeHighlight(task)}>
                Back on your radar <X />
              </button>
            )}
          </div>
        </div>
        <div className="task-actions">
          <button
            className="icon-button"
            disabled={updatingTaskId === task.id}
            onClick={() => openScheduleModal(task)}
            aria-label={`Schedule a reminder for ${task.goal_text}`}
            title="Schedule reminder"
          >
            <Bell />
          </button>
          <button
            className="icon-button"
            disabled={updatingTaskId === task.id}
            onClick={() => openSnoozeModal(task)}
            aria-label={`Remind me later about ${task.goal_text}`}
            title="Remind me later"
          >
            <AlarmClock />
          </button>
          {isCompleted && (
            <button
              className="goal-archive"
              disabled={updatingTaskId === task.id}
              onClick={() => patchTask(task, { status: 'abandoned' })}
              aria-label={`Archive ${task.goal_text}`}
            >
              <Archive /> Archive
            </button>
          )}
        </div>
      </li>
    )
  }

  function renderSnoozedTasks() {
    if (!snoozedTasks.length) return null
    return (
      <div className="snoozed-section">
        <button
          className="snoozed-toggle-button"
          onClick={() => setSnoozedOpen((open) => !open)}
          aria-expanded={snoozedOpen}
        >
          <span><AlarmClock /> Snoozed for later ({snoozedTasks.length})</span>
          {snoozedOpen ? <ChevronUp /> : <ChevronDown />}
        </button>
        {snoozedOpen && (
          <ul className="snoozed-list">
            {snoozedTasks.map((task) => (
              <li key={task.id}>
                <p>{task.goal_text}</p>
                <span>Back on {task.snoozed_until && formatDate(task.snoozed_until)}</span>
                <button
                  className="icon-button"
                  onClick={() => patchTask(task, { snoozed_until: null, remind_at: null })}
                  aria-label={`Unsnooze ${task.goal_text}`}
                  title="Unsnooze"
                >
                  <RotateCcw />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  async function removeActiveEntry() {
    if (!userId || !activeEntry || deletingEntry) return
    if (!window.confirm('Delete this journal entry permanently?')) return
    setDeletingEntry(true)
    setError('')
    try {
      await deleteJournalEntry(userId, activeEntry.id)
      const [refreshedEntries, refreshedTasks] = await Promise.all([
        getEntries(userId),
        getTasks(userId),
      ])
      setEntries(refreshedEntries)
      setTasks(refreshedTasks)
      setActiveEntry(null)
      setNarrativeDraft('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to delete that entry.')
    } finally {
      setDeletingEntry(false)
    }
  }

  async function finishWeeklySession() {
    if (!userId || !weeklySession || finishingWeeklyPlanning) return
    setFinishingWeeklyPlanning(true)
    setError('')
    try {
      const updated = await finishWeeklyPlanning(userId, weekStartOf())
      setWeeklySession(updated)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to finish weekly planning.')
    } finally {
      setFinishingWeeklyPlanning(false)
    }
  }

  async function reopenWeeklySession() {
    if (!userId || startingWeeklyPlanning) return
    setStartingWeeklyPlanning(true)
    setError('')
    try {
      const updated = await startWeeklyPlanning(userId, weekStartOf())
      setWeeklySession(updated)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to re-open weekly planning.')
    } finally {
      setStartingWeeklyPlanning(false)
    }
  }

  function renderWorkingOnCard(subtitle?: string) {
    return (
      <section className="working-card composer-working-card accordion-card">
        <button
          type="button"
          className="card-accordion-head"
          onClick={() => setWorkingOnOpen(!workingOnOpen)}
          aria-expanded={workingOnOpen}
        >
          <div className="card-head-title">
            <WorkingOnIllustration />
            <div>
              {subtitle && <p className="card-subtitle">{subtitle}</p>}
              <h2>What I’m Working On</h2>
            </div>
            {visibleTasks.length > 0 && <span className="accordion-badge">{visibleTasks.length}</span>}
          </div>
          {workingOnOpen ? <ChevronUp /> : <ChevronDown />}
        </button>
        {workingOnOpen && (
          <div className="card-accordion-body">
            {activeEntry?.alignment_summary && <AlignmentSummary text={activeEntry.alignment_summary} />}
            {visibleTasks.length > 0 ? (
              <ul className="goals task-list">{visibleTasks.map(renderTask)}</ul>
            ) : (
              <p className="alignment">No active tasks right now. Add one below (e.g. "remind me on thursday at 9am to drink a protein shake").</p>
            )}
            {renderTaskInputRow()}
            {renderSnoozedTasks()}
          </div>
        )}
      </section>
    )
  }

  function renderMorningTaskPicker(task: Task) {
    const selected = morningSelectedIds.includes(task.id)
    return (
      <li key={task.id} className={selected ? 'bookend-task selected' : 'bookend-task'}>
        <button
          type="button"
          className="bookend-task-toggle"
          onClick={() => toggleMorningTask(task.id)}
          aria-pressed={selected}
        >
          <span className="bookend-checkbox">{selected && <Check />}</span>
          <span className="bookend-task-text">{task.goal_text}</span>
        </button>
      </li>
    )
  }

  function renderMorningBookend() {
    return (
      <section className="bookend-view morning-bookend">
        <div className="bookend-heading">
          <div className="eyebrow"><Sunrise /> Morning bookend</div>
          <h1>What are you doing today?</h1>
          <p>
            Pick a focused list from everything you&apos;re working on. A smaller plan makes it
            easier to actually do the things.
          </p>
        </div>

        <div className="bookend-card">
          <div className="bookend-card-head">
            <WorkingOnIllustration />
            <div>
              <h2>Today&apos;s plan</h2>
              <p className="bookend-card-sub">
                {morningSelectedIds.length
                  ? `${morningSelectedIds.length} selected`
                  : 'Select what you’ll focus on today'}
              </p>
            </div>
          </div>

          {visibleTasks.length > 0 ? (
            <ul className="bookend-task-list">{visibleTasks.map(renderMorningTaskPicker)}</ul>
          ) : (
            <p className="alignment">
              No active tasks yet. Add one below, or skip planning and come back tonight.
            </p>
          )}

          {renderTaskInputRow()}
          {renderSnoozedTasks()}

          <div className="bookend-actions">
            <button
              className="primary-button large"
              disabled={savingMorningPlan || !userId}
              onClick={() => { void startMorningDay() }}
            >
              {savingMorningPlan ? <span className="button-spinner" /> : <Sunrise />}
              Start my day
            </button>
            <button
              className="ghost-button"
              disabled={savingMorningPlan}
              onClick={() => { void skipMorningPlanning() }}
            >
              Skip for now
            </button>
          </div>
        </div>

        <button
          type="button"
          className="bookend-manage-link"
          onClick={() => setShowAllTasks((open) => !open)}
        >
          {showAllTasks ? 'Hide full working list' : 'Manage your full working list'}
          {showAllTasks ? <ChevronUp /> : <ChevronDown />}
        </button>
        {showAllTasks && renderWorkingOnCard('Your full backlog')}
      </section>
    )
  }

  function renderPlannedTaskCheckoff(task: Task) {
    const isCompleted = task.status === 'completed'
    const targetCount = task.target_count ?? 1
    const currentCount = task.current_count ?? (isCompleted ? targetCount : 0)

    return (
      <li key={task.id} className={isCompleted ? 'bookend-task done' : 'bookend-task'}>
        <GoalCheckboxes
          targetCount={targetCount}
          currentCount={currentCount}
          onChange={(newCount) => { void patchTask(task, { current_count: newCount }) }}
        />
        <span className="bookend-task-text">{task.goal_text}</span>
      </li>
    )
  }

  function renderDayBookend() {
    return (
      <section className="bookend-view day-bookend">
        <div className="bookend-heading">
          <div className="eyebrow"><CalendarDays /> Your day</div>
          <h1>Focus on what you picked</h1>
          <p>You planned these for today. Come back tonight to log what you did and reflect.</p>
        </div>

        <div className="bookend-card">
          <div className="bookend-card-head">
            <WorkingOnIllustration />
            <div>
              <h2>Today&apos;s plan</h2>
              <p className="bookend-card-sub">{formatDate(today(), true)}</p>
            </div>
          </div>

          {plannedTasks.length > 0 ? (
            <ul className="bookend-task-list checkoff">
              {plannedTasks.map(renderPlannedTaskCheckoff)}
            </ul>
          ) : (
            <p className="alignment">You skipped picking tasks this morning. You can still close your day tonight.</p>
          )}

          <div className="bookend-actions">
            <button className="primary-button large" onClick={beginEvening}>
              <Moon /> Close my day
            </button>
          </div>
        </div>

        <button
          type="button"
          className="bookend-manage-link"
          onClick={() => setShowAllTasks((open) => !open)}
        >
          {showAllTasks ? 'Hide full working list' : 'Manage your full working list'}
          {showAllTasks ? <ChevronUp /> : <ChevronDown />}
        </button>
        {showAllTasks && renderWorkingOnCard('Your full backlog')}
      </section>
    )
  }

  function renderEveningBookend() {
    const eveningTasks = plannedTasks.length > 0 ? plannedTasks : visibleTasks

    return (
      <section className="bookend-view evening-bookend composer">
        <div className="bookend-heading composer-heading">
          <div className="eyebrow"><Moon /> Evening bookend</div>
          <h1>How did today go?</h1>
          <p>Check off what you got done, then journal about your day.</p>
        </div>

        <div className="bookend-card">
          <div className="bookend-card-head">
            <WorkingOnIllustration />
            <div>
              <h2>{plannedTasks.length > 0 ? 'Today\'s plan' : 'What you worked on'}</h2>
              <p className="bookend-card-sub">Mark anything you finished</p>
            </div>
          </div>
          {eveningTasks.length > 0 ? (
            <ul className="bookend-task-list checkoff">
              {eveningTasks.map(renderPlannedTaskCheckoff)}
            </ul>
          ) : (
            <p className="alignment">No tasks to check off — jump straight into your reflection.</p>
          )}
        </div>

        <div className={listening ? 'editor-card listening' : 'editor-card'}>
          <textarea
            ref={editorRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Today I..."
            aria-label="Journal entry"
          />
          <div className="editor-toolbar">
            <div className="editor-tools">
              <button className={listening ? 'voice-button active' : 'voice-button'} onClick={toggleVoice}>
                <Mic /> {listening ? 'Listening...' : 'Voice dump'}
              </button>
            </div>
            <span className="word-count">{draft.trim() ? draft.trim().split(/\s+/).length : 0} words</span>
          </div>
        </div>

        <div className="composer-submit">
          <div className="composer-submit-meta">
            <label className="verbatim-toggle">
              <input
                type="checkbox"
                checked={!saveVerbatim}
                onChange={(event) => setSaveVerbatim(!event.target.checked)}
              />
              <span>Use AI rewrite</span>
            </label>
            <p>
              {saveVerbatim ? (
                <>Your entry will be saved word for word. Tasks in your text can still be picked up.</>
              ) : (
                <><Sparkles /> AI will polish your entry and help you reflect.</>
              )}
            </p>
          </div>
          <button
            className="primary-button large"
            disabled={!draft.trim() || !userId}
            onClick={submitEntry}
          >
            {saveVerbatim ? 'Save to my journal' : 'Reflect on my day'} <ChevronRight />
          </button>
        </div>
      </section>
    )
  }

  function renderWeeklyGoalsCard() {
    return (
      <section className="working-card composer-working-card accordion-card">
        <button
          type="button"
          className="card-accordion-head"
          onClick={() => setWeeklyGoalsOpen(!weeklyGoalsOpen)}
          aria-expanded={weeklyGoalsOpen}
        >
          <div className="card-head-title">
            <WeeklyGoalsIllustration />
            <div>
              <p className="card-subtitle">{formatWeekRange(weekStartOf())}</p>
              <h2>This week's goals</h2>
            </div>
            {journalGoals.length > 0 && <span className="accordion-badge">{journalGoals.length}</span>}
          </div>
          {weeklyGoalsOpen ? <ChevronUp /> : <ChevronDown />}
        </button>
        {weeklyGoalsOpen && (
          <div className="card-accordion-body">
            {journalGoals.length > 0 ? (
              <ul className="goals">{journalGoals.map((goal) => renderGoal(goal))}</ul>
            ) : (
              <p className="alignment">No goals set for this week yet. Add one below.</p>
            )}
            <div className="goal-input-row">
              <input
                value={newGoalDraft}
                onChange={(event) => setNewGoalDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') addWeeklyGoal() }}
                placeholder="Input your goal here"
                aria-label="New goal for the week"
              />
              <div className="target-count-selector">
                <label htmlFor="composer-target-count-select">Target:</label>
                <select
                  id="composer-target-count-select"
                  value={newGoalTargetCount}
                  onChange={(e) => setNewGoalTargetCount(Number(e.target.value))}
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 30, 50, 100].map((n) => (
                    <option key={n} value={n}>{n}x</option>
                  ))}
                </select>
              </div>
              <button className="primary-button" disabled={!newGoalDraft.trim() || addingGoal} onClick={addWeeklyGoal}>
                {addingGoal ? <span className="button-spinner" /> : <Plus />} Add goal
              </button>
            </div>
          </div>
        )}
      </section>
    )
  }

  function renderNextWeekRemindersCard() {
    return (
      <section className="working-card composer-working-card accordion-card">
        <button
          type="button"
          className="card-accordion-head"
          onClick={() => setNextWeekRemindersOpen(!nextWeekRemindersOpen)}
          aria-expanded={nextWeekRemindersOpen}
        >
          <div className="card-head-title">
            <RemindersIllustration />
            <div>
              <p className="card-subtitle">Planning ahead</p>
              <h2>Reminders for next week</h2>
            </div>
            {percyReminders.length > 0 && <span className="accordion-badge">{percyReminders.length}</span>}
          </div>
          {nextWeekRemindersOpen ? <ChevronUp /> : <ChevronDown />}
        </button>
        {nextWeekRemindersOpen && (
          <div className="card-accordion-body">
            <p className="alignment">
              Put any notes or reminders for next week here. When you start weekly planning, all these reminders will show up there too!
            </p>
            {percyReminders.length > 0 ? (
              <ul className="reminder-list">
                {percyReminders.map((reminder) => (
                  <li key={reminder.id}>
                    <p>{reminder.reminder_text}</p>
                    <button
                      className="icon-button"
                      onClick={() => removeNextWeekReminder(reminder.id)}
                      aria-label="Remove reminder"
                      title="Remove reminder"
                    >
                      <Trash2 />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="alignment">No reminders added for next week yet.</p>
            )}
            <div className="goal-input-row">
              <input
                value={newNextWeekReminderDraft}
                onChange={(event) => setNewNextWeekReminderDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') addNextWeekReminder() }}
                placeholder="Add a reminder for next week..."
                aria-label="Reminder for next week"
              />
              <button
                className="primary-button"
                disabled={!newNextWeekReminderDraft.trim() || addingNextWeekReminder}
                onClick={addNextWeekReminder}
              >
                {addingNextWeekReminder ? <span className="button-spinner" /> : <Plus />} Add reminder
              </button>
            </div>
          </div>
        )}
      </section>
    )
  }

  async function beginStartWeeklyPlanning() {
    if (!userId || startingWeeklyPlanning) return
    setStartingWeeklyPlanning(true)
    setError('')
    try {
      const created = await startWeeklyPlanning(userId, weekStartOf())
      setWeeklySession(created)
      const [reminders, taskList, goals, lastWeek] = await Promise.all([
        getPercyReminders(userId),
        getTasks(userId),
        getWeeklyGoals(userId, weekStartOf()),
        getWeeklyGoals(userId, addDaysToIsoDate(weekStartOf(), -7)),
      ])
      setPercyReminders(reminders)
      setTasks(taskList)
      setWeeklyGoals(goals)
      setLastWeekGoals(lastWeek)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to start weekly planning.')
    } finally {
      setStartingWeeklyPlanning(false)
    }
  }

  async function handleGenerateWeeklyReflection() {
    if (!userId || generatingReflection) return
    setGeneratingReflection(true)
    setError('')
    try {
      const updatedSession = await generateWeeklyReflection(userId, weekStartOf())
      setWeeklySession(updatedSession)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to generate weekly reflection.')
    } finally {
      setGeneratingReflection(false)
    }
  }

  async function connectGoogle() {
    if (!userId || connectingGoogle) return
    setConnectingGoogle(true)
    setError('')
    try {
      const url = await getGoogleAuthorizeUrl(userId)
      window.location.href = url
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to connect Google Calendar.')
      setConnectingGoogle(false)
    }
  }

  async function disconnectGoogleAccount() {
    if (!userId) return
    setConnectingGoogle(true)
    setError('')
    try {
      const status = await disconnectGoogle(userId)
      setGoogleStatus(status)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to disconnect Google Calendar.')
    } finally {
      setConnectingGoogle(false)
    }
  }

  async function sendPercyMessage(promptText?: string, insightOverride?: { id?: string; text: string }) {
    const textToSend = promptText ?? chatInput.trim()
    if (!userId || !textToSend || chatLoading) return

    const targetInsight = insightOverride ?? activeChatInsight
    const userMsg: PercyChatMessage = { role: 'user', content: textToSend }
    const newHistory = [...chatMessages, userMsg]

    setChatMessages(newHistory)
    if (!promptText) setChatInput('')
    setChatLoading(true)
    setError('')

    try {
      const res = await chatWithPercy(
        userId,
        textToSend,
        chatMessages,
        targetInsight?.id,
        targetInsight?.text,
      )
      setChatMessages([...newHistory, { role: 'assistant', content: res.reply }])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to chat with Percy right now.')
    } finally {
      setChatLoading(false)
    }
  }

  function askPercyAboutInsight(insight: LifeInsight) {
    setActiveChatInsight({ id: insight.id, text: insight.insight_text })
    const prompt = `Can you tell me more about this insight and how you reached this conclusion: "${insight.insight_text}"?`
    setChatInput(prompt)
    setInsightsOpen(true)
    setTimeout(() => {
      percyChatRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      percyInputRef.current?.focus()
    }, 50)
  }

  function renderPercyChat() {
    const suggestions = [
      "Tell me about myself based on my journal entries",
      "What recurring patterns or habits do you notice in me?",
      "What helps me feel most productive and satisfied?",
      "How are my goals aligning with my daily reflections?",
    ]

    return (
      <div className="percy-chatbox" ref={percyChatRef}>
        <div className="percy-chat-head">
          <div className="percy-avatar"><Sparkles /></div>
          <div>
            <h3>Chat with Percy</h3>
            <p>Ask Percy anything about your reflections, habits, or insights.</p>
          </div>
        </div>

        {activeChatInsight && (
          <div className="percy-focus-badge">
            <span>Focusing on insight: "{activeChatInsight.text}"</span>
            <button className="icon-button" onClick={() => setActiveChatInsight(null)} title="Clear focus"><X /></button>
          </div>
        )}

        {chatMessages.length === 0 && (
          <div className="percy-suggestions">
            <p>Need inspiration? Ask Percy:</p>
            <div className="suggestion-chips">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="suggestion-chip"
                  onClick={() => void sendPercyMessage(suggestion)}
                >
                  <MessageCircle /> {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {chatMessages.length > 0 && (
          <div className="percy-messages-list">
            {chatMessages.map((msg, index) => (
              <div key={index} className={`percy-message ${msg.role}`}>
                <div className="message-header">
                  <div className="message-sender">
                    {msg.role === 'assistant' ? <Sparkles /> : <UserIcon />}
                    <span>{msg.role === 'assistant' ? 'Percy' : 'You'}</span>
                  </div>
                  {msg.role === 'assistant' && (
                    <button
                      type="button"
                      className={`save-advice-btn${isAdviceSaved(msg.content) ? ' saved' : ''}`}
                      disabled={isAdviceSaved(msg.content) || savingAdviceIndex === index}
                      onClick={() => void savePercyAdvice(index)}
                      title={isAdviceSaved(msg.content) ? 'Saved' : 'Save this advice'}
                    >
                      {savingAdviceIndex === index ? (
                        <span className="button-spinner" />
                      ) : (
                        <Bookmark fill={isAdviceSaved(msg.content) ? 'currentColor' : 'none'} />
                      )}
                      {isAdviceSaved(msg.content) ? 'Saved' : 'Save'}
                    </button>
                  )}
                </div>
                <p className="message-content">{msg.content}</p>
              </div>
            ))}
            {chatLoading && (
              <div className="percy-message assistant loading">
                <div className="message-sender"><Sparkles /><span>Percy thinking...</span></div>
                <div className="typing-dots"><span /><span /><span /></div>
              </div>
            )}
          </div>
        )}

        {savedPercyAdvice.length > 0 && (
          <div className="saved-advice-section">
            <div className="saved-advice-head">
              <Bookmark />
              <h4>Saved Advice</h4>
              <span className="accordion-badge">{savedPercyAdvice.length}</span>
            </div>
            <ul className="saved-advice-list">
              {savedPercyAdvice.map((item) => (
                <li key={item.id} className="saved-advice-item">
                  <div className="saved-advice-content">
                    {item.context_question && (
                      <p className="saved-advice-context">You asked: {item.context_question}</p>
                    )}
                    <p className="saved-advice-text">{item.advice_text}</p>
                    <span className="saved-advice-date">{formatDate(item.created_at.slice(0, 10))}</span>
                  </div>
                  <button
                    type="button"
                    className="icon-button saved-advice-delete"
                    disabled={deletingAdviceId === item.id}
                    onClick={() => void removeSavedAdvice(item.id)}
                    aria-label="Remove saved advice"
                    title="Remove"
                  >
                    <Trash2 />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="percy-chat-input-row">
          <input
            ref={percyInputRef}
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void sendPercyMessage() }}
            placeholder="Ask Percy about yourself, habits, or insights..."
            disabled={chatLoading}
          />
          <button
            className="primary-button"
            disabled={!chatInput.trim() || chatLoading}
            onClick={() => void sendPercyMessage()}
          >
            {chatLoading ? <span className="button-spinner" /> : <Send />} Ask Percy
          </button>
        </div>
      </div>
    )
  }

  async function handlePercyCreateGoal() {
    if (!userId || !percyGoalQuery.trim() || creatingPercyGoal) return
    setCreatingPercyGoal(true)
    setError('')
    setPercyGoalReply('')
    try {
      const res = await createGoalWithPercy(userId, percyGoalQuery.trim(), weekStartOf())
      setWeeklyGoals((current) => [...current, res.goal])
      setPercyGoalReply(res.reply)
      setPercyGoalQuery('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create goal with Percy right now.')
    } finally {
      setCreatingPercyGoal(false)
    }
  }

  function renderPercyGoalSetter() {
    return (
      <div className="percy-goal-card">
        <div className="percy-goal-head">
          <div className="percy-avatar"><Sparkles /></div>
          <div>
            <h3>Set Goals with Percy</h3>
            <p>Describe your goal in plain English (e.g., "I want to go to the gym every day this week at 9am-10am"). Percy will extract the targets and set up calendar reminders!</p>
          </div>
        </div>

        {percyGoalReply && (
          <div className="percy-goal-reply">
            <Sparkles />
            <p>{percyGoalReply}</p>
            <button className="icon-button" onClick={() => setPercyGoalReply('')} title="Dismiss"><X /></button>
          </div>
        )}

        <div className="percy-goal-input-row">
          <input
            value={percyGoalQuery}
            onChange={(e) => setPercyGoalQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handlePercyCreateGoal() }}
            placeholder='e.g. I want to go to the gym every day this week. Remind me at 9am-10am every day.'
            disabled={creatingPercyGoal}
          />
          <button
            className="primary-button"
            disabled={!percyGoalQuery.trim() || creatingPercyGoal}
            onClick={() => void handlePercyCreateGoal()}
          >
            {creatingPercyGoal ? <span className="button-spinner" /> : <Sparkles />} Set Goal
          </button>
        </div>
      </div>
    )
  }

  if (authChecking) {
    return (
      <div className="auth-container">
        <div style={{ textAlign: 'center', color: 'var(--muted)' }}>Loading journal...</div>
      </div>
    )
  }

  if (!sessionUser) {
    return <Auth onAuthSuccess={() => {}} />
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="sidebar-toggle icon-button"
          onClick={toggleSidebar}
          aria-label={sidebarOpen ? 'Collapse journal history' : 'Open journal history'}
          aria-pressed={sidebarOpen}
        >
          {sidebarOpen ? <PanelLeftClose /> : <Menu />}
        </button>
        <button className="wordmark" onClick={() => startNewEntry()} aria-label="Bookends home">
          <span className="wordmark-mark"><BookOpen /></span><span>Bookends</span>
        </button>
        <nav aria-label="Primary navigation">
          <button className={view === 'journal' ? 'nav-link active' : 'nav-link'} onClick={() => { setComposingNewEntry(false); setView('journal') }}>Today</button>
          <button className={view === 'weekly' ? 'nav-link active' : 'nav-link'} onClick={() => setView('weekly')}><CalendarRange /> Weekly Planning</button>
          <button className={view === 'import' ? 'nav-link active' : 'nav-link'} onClick={() => setView('import')}><Upload /> Import</button>
          <button className={view === 'northstar' ? 'nav-link active' : 'nav-link'} onClick={() => setView('northstar')}>
            <Compass /> North Star
            {unreadInsightCount > 0 && (
              <span className="nav-badge" aria-label={`${unreadInsightCount} new insight${unreadInsightCount === 1 ? '' : 's'}`} />
            )}
          </button>
        </nav>
      </header>

      <aside className={sidebarOpen ? 'sidebar open' : 'sidebar'}>
        <div className="sidebar-mobile-head"><span>Journal history</span><button className="icon-button" onClick={() => setSidebarOpen(false)} aria-label="Close history"><X /></button></div>
        <button className="new-entry-button" onClick={() => { setEntryDate(today()); startNewEntry() }}><Plus /> Write an entry</button>
        <label className="search-box"><Search /><span className="sr-only">Search entries</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your journal..." /></label>

        <div className="entry-list" ref={entryListRef}>
          {loading ? (
            <div className="sidebar-skeleton" aria-label="Loading entries">{[1, 2, 3].map((item) => <span key={item} />)}</div>
          ) : filteredEntries.length ? filteredEntries.map((entry) => (
            <button
              className={activeEntry?.id === entry.id ? 'entry-item active' : 'entry-item'}
              data-entry-date={entry.date}
              data-entry-id={entry.id}
              key={entry.id}
              onClick={() => openEntry(entry)}
            >
              <span className="entry-item-date">{formatDate(entry.date)}</span>
              <strong>{entryTitle(entry)}</strong>
              <span className="entry-preview">{entry.raw_transcript}</span>
            </button>
          )) : (
            <div className="empty-history">
              <span className="empty-icon"><BookOpen /></span>
              <strong>{search ? 'No entries found' : 'Your story starts here'}</strong>
              <p>{search ? 'Try a different search.' : 'Write a few words about your day. There’s no right way to begin.'}</p>
            </div>
          )}
        </div>
        <div className="sidebar-footer"><LockKeyhole /><span>Private to you</span></div>
      </aside>
      {sidebarOpen && <button className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close history" />}

      <main className={sidebarOpen ? 'workspace' : 'workspace sidebar-collapsed'} aria-busy={loading || generating}>
        {error && <div className="error-toast" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss"><X /></button></div>}
        {googleNotice && <div className="notice-toast" role="status"><span>{googleNotice}</span><button onClick={() => setGoogleNotice('')} aria-label="Dismiss"><X /></button></div>}
        {scheduleModal && (
          <ScheduleModal
            state={scheduleModal}
            onClose={() => setScheduleModal(null)}
            onSave={saveScheduleModal}
            onClear={
              scheduleModal.mode === 'reminder'
                ? (scheduleModal.item.remind_at ? clearScheduleModal : null)
                : (scheduleModal.item.snoozed_until ? clearScheduleModal : null)
            }
            saving={savingSchedule}
            googleConnected={Boolean(googleStatus?.connected)}
            onConnectGoogle={connectGoogle}
            connectingGoogle={connectingGoogle}
          />
        )}

        {view === 'northstar' ? (
          <section className="settings-view">
            <div className="eyebrow"><Compass /> Personal context</div>
            <h1>Your North Star & Insights</h1>
            <p className="settings-intro">Your core values, calendar reminders, spelling corrections, and interactive AI insights from Percy.</p>

            <div className="settings-card accordion-card">
              <button
                type="button"
                className="card-accordion-head"
                onClick={() => setNorthStarOpen(!northStarOpen)}
                aria-expanded={northStarOpen}
              >
                <div className="card-head-title"><Compass /> <h2>Your North Star</h2></div>
                {northStarOpen ? <ChevronUp /> : <ChevronDown />}
              </button>
              {northStarOpen && (
                <div className="card-accordion-body">
                  <div className="field-heading">
                    <div><label htmlFor="north-star">Your North Star</label><span>Optional</span></div>
                    <p>Not required. Add this any time if it’s useful to you.</p>
                  </div>
                  <textarea id="north-star" value={northStar} onChange={(event) => setNorthStar(event.target.value)} placeholder="For example: Be present with the people I love, keep learning, and make things that matter." rows={6} />
                  <div className="settings-actions">
                    <span>{northStar.length.toLocaleString()} characters</span>
                    <button className="primary-button" disabled={savingSettings || northStar === savedNorthStar} onClick={updateNorthStar}>
                      {savingSettings ? <span className="button-spinner" /> : <Check />}
                      {savingSettings ? 'Saving...' : northStar === savedNorthStar ? 'Saved' : 'Save changes'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="settings-card google-card accordion-card">
              <button
                type="button"
                className="card-accordion-head"
                onClick={() => setCalendarOpen(!calendarOpen)}
                aria-expanded={calendarOpen}
              >
                <div className="card-head-title"><CalendarRange /> <h2>Google Calendar reminders</h2></div>
                {calendarOpen ? <ChevronUp /> : <ChevronDown />}
              </button>
              {calendarOpen && (
                <div className="card-accordion-body">
                  <p className="alignment">Connect your Google account so scheduled reminders show up as calendar events with phone notifications.</p>
                  {googleStatus?.connected ? (
                    <div className="google-status">
                      <span className="google-connected"><Link2 /> Connected{googleStatus.email ? ` as ${googleStatus.email}` : ''}</span>
                      <button className="ghost-button" disabled={connectingGoogle} onClick={disconnectGoogleAccount}>
                        <Unlink /> Disconnect
                      </button>
                    </div>
                  ) : (
                    <button className="primary-button" disabled={connectingGoogle} onClick={connectGoogle}>
                      {connectingGoogle ? <span className="button-spinner" /> : <Link2 />} Connect Google Calendar
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="settings-card spelling-card accordion-card">
              <button
                type="button"
                className="card-accordion-head"
                onClick={() => setSpellingOpen(!spellingOpen)}
                aria-expanded={spellingOpen}
              >
                <div className="card-head-title">
                  <SpellCheck /> <h2>Learned Spelling & Corrections</h2>
                  {spellingCorrections.length > 0 && <span className="accordion-badge">{spellingCorrections.length}</span>}
                </div>
                {spellingOpen ? <ChevronUp /> : <ChevronDown />}
              </button>
              {spellingOpen && (
                <div className="card-accordion-body">
                  <p className="alignment">Speech-to-text often mishears names and terms. When you edit a journal entry, MyJourn learns your corrections so future entries are spelled right automatically.</p>
                  {spellingCorrections.length > 0 && (
                    <ul className="spelling-list">
                      {spellingCorrections.map((corr) => (
                        <li key={corr.id} className="spelling-item">
                          <span className="spelling-pair">
                            <code className="incorrect-badge">{corr.incorrect_word}</code>
                            <span className="spelling-arrow">→</span>
                            <strong className="correct-badge">{corr.correct_word}</strong>
                          </span>
                          {corr.correction_count > 1 && (
                            <span className="correction-count">{corr.correction_count}× corrected</span>
                          )}
                          <button
                            className="icon-button spelling-delete"
                            disabled={deletingCorrectionId === corr.id}
                            onClick={() => removeSpellingCorrection(corr.id)}
                            aria-label={`Remove correction for ${corr.incorrect_word}`}
                          >
                            <Trash2 />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="spelling-input-row">
                    <input
                      value={newIncorrectDraft}
                      onChange={(e) => setNewIncorrectDraft(e.target.value)}
                      placeholder="Misspelling (e.g. Tyce)"
                      aria-label="Misheard word or misspelling"
                    />
                    <span className="spelling-arrow">→</span>
                    <input
                      value={newCorrectDraft}
                      onChange={(e) => setNewCorrectDraft(e.target.value)}
                      placeholder="Correct spelling (e.g. Thys)"
                      aria-label="Correct spelling"
                      onKeyDown={(e) => { if (e.key === 'Enter') addSpellingCorrection() }}
                    />
                    <button
                      className="primary-button"
                      disabled={!newIncorrectDraft.trim() || !newCorrectDraft.trim() || addingCorrection}
                      onClick={addSpellingCorrection}
                    >
                      {addingCorrection ? <span className="button-spinner" /> : <Plus />} Add
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="settings-card accordion-card">
              <button
                type="button"
                className="card-accordion-head"
                onClick={() => setInsightsOpen(!insightsOpen)}
                aria-expanded={insightsOpen}
              >
                <div className="card-head-title">
                  <Lightbulb /> <h2>AI Insights & Percy Chat</h2>
                  {(lifeInsights.length > 0 || savedPercyAdvice.length > 0) && (
                    <span className="accordion-badge">{lifeInsights.length + savedPercyAdvice.length}</span>
                  )}
                </div>
                {insightsOpen ? <ChevronUp /> : <ChevronDown />}
              </button>
              {insightsOpen && (
                <div className="card-accordion-body">
                  <p className="alignment">Patterns MyJourn has noticed in your life. Click "Ask Percy" on any insight to explore how the AI reached that conclusion!</p>
                  {lifeInsights.length ? (
                    <ul className="insight-list">
                      {lifeInsights.map((insight) => (
                        <li className={insight.is_read ? 'insight-item' : 'insight-item unread'} key={insight.id}>
                          <span className="insight-icon"><Lightbulb /></span>
                          <div className="insight-content">
                            <p>{insight.insight_text}</p>
                            <span className="insight-date">{formatDate(insight.created_at.slice(0, 10))}</span>
                          </div>
                          <div className="insight-actions">
                            <button
                              type="button"
                              className="insight-ask-btn"
                              onClick={() => askPercyAboutInsight(insight)}
                              title="Ask Percy how this conclusion was reached"
                            >
                              <MessageCircle /> Ask Percy
                            </button>
                            <button
                              className="icon-button insight-dismiss"
                              onClick={() => dismissInsight(insight.id)}
                              aria-label="I've seen this, stop showing it"
                              title="I've seen this"
                            >
                              <Check />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="empty-history">
                      <span className="empty-icon"><Lightbulb /></span>
                      <strong>No insights yet</strong>
                      <p>As you keep journaling, MyJourn will surface patterns worth noticing here.</p>
                    </div>
                  )}

                  {renderPercyChat()}
                </div>
              )}
            </div>

            <div className="settings-card account-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h2 style={{ fontSize: '1.15rem', fontWeight: 600, margin: 0, color: 'var(--ink)' }}>Account</h2>
                  {sessionUser?.email && (
                    <p style={{ color: '#666', fontSize: '0.9rem', margin: '0.25rem 0 0' }}>
                      Signed in as <strong>{sessionUser.email}</strong>
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  style={{ color: '#dc2626', borderColor: 'rgba(220, 38, 38, 0.3)', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                  onClick={() => supabase.auth.signOut()}
                >
                  <LogOut size={16} />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          </section>
        ) : view === 'weekly' ? (
          <section className="weekly-view">
            <div className="eyebrow"><CalendarRange /> Weekly ritual</div>
            <h1>Weekly Planning</h1>
            <p className="settings-intro">{formatWeekRange(weekStartOf())}</p>

            {weeklyLoading || !weeklySessionChecked ? (
              <div className="sidebar-skeleton" aria-label="Loading weekly planning">{[1, 2, 3].map((item) => <span key={item} />)}</div>
            ) : !weeklySession ? (
              <div className="weekly-card weekly-gate">
                <div className="card-title"><span><PlayCircle /></span><div><p>Get started</p><h2>Start this week's planning</h2></div></div>
                <p className="alignment">
                  Review last week's goals, clear out Percy's reminders, and set your intentions for the
                  week ahead. Press start to see everything for this week.
                </p>
                <button className="primary-button large" disabled={startingWeeklyPlanning} onClick={beginStartWeeklyPlanning}>
                  {startingWeeklyPlanning ? <span className="button-spinner" /> : <PlayCircle />} Start weekly planning
                </button>
              </div>
            ) : weeklySession.completed_at ? (
              <>
                <div className="weekly-card weekly-gate weekly-completed">
                  <div className="card-title"><span><CircleCheck /></span><div><p>Weekly Planning</p><h2>Weekly planning complete!</h2></div></div>
                  <p className="alignment">
                    Your goals and reminders for this week have been saved. You can view and check off your goals on your main journal page as you go!
                  </p>
                  <button className="ghost-button" disabled={startingWeeklyPlanning} onClick={reopenWeeklySession}>
                    <RotateCcw /> Re-open weekly planning
                  </button>
                </div>

                {weeklySession.reflection_data && (
                  <div className="weekly-card reflection-card">
                    <div className="card-title">
                      <WeeklyReflectionIllustration />
                      <div>
                        <p>Weekly Digest</p>
                        <h2>Weekly AI Reflection</h2>
                      </div>
                    </div>
                    {weeklySession.reflection_start_date && weeklySession.reflection_end_date && (
                      <p className="alignment reflection-subtitle">
                        Covering {formatDate(weeklySession.reflection_start_date)} – {formatDate(weeklySession.reflection_end_date)}
                      </p>
                    )}
                    <div className="reflection-content">
                      <div className="reflection-section narrative-section">
                        <p className="narrative-text">{weeklySession.reflection_data.summary_narrative}</p>
                      </div>
                      <div className="reflection-grid">
                        <div className="reflection-box positive-box">
                          <h3>What Went Well</h3>
                          <ul>
                            {weeklySession.reflection_data.what_went_well.map((item, idx) => (
                              <li key={idx}>{item}</li>
                            ))}
                          </ul>
                        </div>
                        <div className="reflection-box hard-box">
                          <h3>What Was Hard</h3>
                          <ul>
                            {weeklySession.reflection_data.what_was_hard.map((item, idx) => (
                              <li key={idx}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                      {weeklySession.reflection_data.patterns_worth_noticing && weeklySession.reflection_data.patterns_worth_noticing.length > 0 && (
                        <div className="reflection-box pattern-box">
                          <h3>Patterns Worth Noticing</h3>
                          <ul>
                            {weeklySession.reflection_data.patterns_worth_noticing.map((item, idx) => (
                              <li key={idx}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {weeklySession.reflection_data.suggested_focuses && weeklySession.reflection_data.suggested_focuses.length > 0 && (
                        <div className="reflection-box focus-box">
                          <h3>Suggested Focus for Next Week</h3>
                          <ul>
                            {weeklySession.reflection_data.suggested_focuses.map((item, idx) => (
                              <li key={idx}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="weekly-card reflection-card">
                  <div className="card-title">
                    <WeeklyReflectionIllustration />
                    <div>
                      <p>Weekly Digest</p>
                      <h2>Weekly AI Reflection</h2>
                    </div>
                  </div>
                  {weeklySession?.reflection_start_date && weeklySession?.reflection_end_date && (
                    <p className="alignment reflection-subtitle">
                      Covering {formatDate(weeklySession.reflection_start_date)} – {formatDate(weeklySession.reflection_end_date)}
                    </p>
                  )}
                  {generatingReflection ? (
                    <div className="reflection-loading">
                      <span className="button-spinner" />
                      <span>Generating your weekly reflection...</span>
                    </div>
                  ) : weeklySession?.reflection_data ? (
                    <div className="reflection-content">
                      <div className="reflection-section narrative-section">
                        <p className="narrative-text">{weeklySession.reflection_data.summary_narrative}</p>
                      </div>
                      <div className="reflection-grid">
                        <div className="reflection-box positive-box">
                          <h3>What Went Well</h3>
                          <ul>
                            {weeklySession.reflection_data.what_went_well.map((item, idx) => (
                              <li key={idx}>{item}</li>
                            ))}
                          </ul>
                        </div>
                        <div className="reflection-box hard-box">
                          <h3>What Was Hard</h3>
                          <ul>
                            {weeklySession.reflection_data.what_was_hard.map((item, idx) => (
                              <li key={idx}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                      {weeklySession.reflection_data.patterns_worth_noticing && weeklySession.reflection_data.patterns_worth_noticing.length > 0 && (
                        <div className="reflection-box pattern-box">
                          <h3>Patterns Worth Noticing</h3>
                          <ul>
                            {weeklySession.reflection_data.patterns_worth_noticing.map((item, idx) => (
                              <li key={idx}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {weeklySession.reflection_data.suggested_focuses && weeklySession.reflection_data.suggested_focuses.length > 0 && (
                        <div className="reflection-box focus-box">
                          <h3>Suggested Focus for Next Week</h3>
                          <ul>
                            {weeklySession.reflection_data.suggested_focuses.map((item, idx) => (
                              <li key={idx}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className="reflection-actions">
                        <button
                          className="ghost-button small"
                          disabled={generatingReflection}
                          onClick={handleGenerateWeeklyReflection}
                        >
                          <RotateCcw size={14} /> Regenerate weekly reflection
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="reflection-empty">
                      <p className="alignment">
                        A structured summary of your week's journal entries, specific wins, genuine struggles, and suggested focus areas.
                      </p>
                      <button
                        className="primary-button"
                        disabled={generatingReflection}
                        onClick={handleGenerateWeeklyReflection}
                      >
                        {generatingReflection ? <span className="button-spinner" /> : <Sparkles size={16} />} Generate my weekly reflection
                      </button>
                    </div>
                  )}
                </div>
                <div className="weekly-card">
                  <div className="card-title"><RemindersIllustration /><div><p>From Percy & Reminders Tab</p><h2>Reminders for this week</h2></div></div>
                  {percyReminders.length ? (
                    <ul className="reminder-list">
                      {percyReminders.map((reminder) => (
                        <li key={reminder.id}>
                          <p>{reminder.reminder_text}</p>
                          <button
                            className="icon-button"
                            disabled={dismissingReminderId === reminder.id}
                            onClick={() => dismissReminder(reminder.id)}
                            aria-label="Mark this reminder as handled"
                          >
                            <Check />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="alignment">Nothing from Percy or your reminders tab this week. When you add reminders on the main journal page or say “Percy, remind me…” while journaling, it’ll show up here.</p>
                  )}
                </div>

                <div className="weekly-card">
                  <div className="card-title"><WorkingOnIllustration /><div><p>Day to day</p><h2>What I'm Working On</h2></div></div>
                  <p className="alignment">These are your ongoing tasks, not this week's goals — a good reference while you plan below.</p>
                  {visibleTasks.length > 0 ? (
                    <ul className="goals task-list">{visibleTasks.map(renderTask)}</ul>
                  ) : (
                    <p className="alignment">Nothing here yet.</p>
                  )}
                  {renderTaskInputRow()}
                  {renderSnoozedTasks()}
                </div>

                <div className="weekly-card">
                  <div className="card-title"><ReviewLastWeekIllustration /><div><p>Look back</p><h2>Review last week's goals</h2></div></div>
                  {lastWeekGoals.length ? (
                    <ul className="goals">{lastWeekGoals.map((goal) => renderGoal(goal, { readOnly: true }))}</ul>
                  ) : (
                    <p className="alignment">No goals were set last week.</p>
                  )}
                </div>

                <div className="weekly-card">
                  <div className="card-title"><SevenDaysWinsIllustration /><div><p>Look back</p><h2>Your last seven days</h2></div></div>
                  {weeklyWins.length ? (
                    <ul className="goals">
                      {weeklyWins.map((goal) => (
                        <li className="goal-completed" key={goal.id}><span><Check /></span><p>{goal.goal_text}</p></li>
                      ))}
                    </ul>
                  ) : (
                    <p className="alignment">
                      {weeklyEntryCount
                        ? `${weeklyEntryCount} entr${weeklyEntryCount === 1 ? 'y' : 'ies'} this week, no tasks marked complete yet.`
                        : 'No entries yet this week.'}
                    </p>
                  )}
                </div>

                <div className="weekly-card">
                  <div className="card-title"><WeeklyGoalsIllustration /><div><p>Look ahead</p><h2>Set your goals for this week</h2></div></div>
                  {weeklyGoals.length > 0 && (
                    <ul className="goals">
                      {weeklyGoals.map((goal) => renderGoal(goal))}
                    </ul>
                  )}
                  <div className="goal-input-row">
                    <input
                      value={newGoalDraft}
                      onChange={(event) => setNewGoalDraft(event.target.value)}
                      onKeyDown={(event) => { if (event.key === 'Enter') addWeeklyGoal() }}
                      placeholder="Input your goal here"
                      aria-label="New goal for the week"
                    />
                    <div className="target-count-selector">
                      <label htmlFor="weekly-target-count-select">Target:</label>
                      <select
                        id="weekly-target-count-select"
                        value={newGoalTargetCount}
                        onChange={(e) => setNewGoalTargetCount(Number(e.target.value))}
                      >
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 30, 50, 100].map((n) => (
                          <option key={n} value={n}>{n}x</option>
                        ))}
                      </select>
                    </div>
                    <button className="primary-button" disabled={!newGoalDraft.trim() || addingGoal} onClick={addWeeklyGoal}>
                      {addingGoal ? <span className="button-spinner" /> : <Plus />} Add goal
                    </button>
                  </div>
                  {renderPercyGoalSetter()}
                </div>

                <div className="weekly-finish-bar">
                  <button
                    className="primary-button large finish-planning-btn"
                    disabled={finishingWeeklyPlanning}
                    onClick={finishWeeklySession}
                  >
                    {finishingWeeklyPlanning ? <span className="button-spinner" /> : <CircleCheck />} Finish weekly planning
                  </button>
                </div>
              </>
            )}
          </section>
        ) : view === 'import' ? (
          <section className="import-view">
            <div className="eyebrow"><Upload /> Migrate your history</div>
            <h1>Bring your past journals in</h1>
            <p className="settings-intro">
              Add entries you wrote before MyJourn. We’ll run each one through the same reflection
              engine used for new entries, in date order, so we can start recognizing your patterns,
              open loops, and progress right away.
            </p>

            <div className="settings-card import-bulk-card">
              <div className="field-heading">
                <div><label htmlFor="import-bulk">Paste multiple entries at once</label><span>Optional</span></div>
                <p>
                  Start each entry with its date on its own line — <code>2024-01-15</code>,{' '}
                  <code>1/15/2024</code>, or <code>January 15, 2024</code> all work — then the entry text below it.
                </p>
              </div>
              <textarea
                id="import-bulk"
                value={importBulkText}
                onChange={(event) => setImportBulkText(event.target.value)}
                placeholder={'2024-01-15\nToday I finally started running again...\n\n2024-01-16\nRough night of sleep, but a good talk with...'}
                rows={7}
              />
              <div className="settings-actions">
                <span>{importRows.filter((row) => row.date && row.text.trim()).length} entries staged below</span>
                <button className="ghost-button" disabled={!importBulkText.trim()} onClick={parseBulkImport}>
                  <ChevronRight /> Parse into entries
                </button>
              </div>
            </div>

            <div className="import-rows">
              {importRows.map((row, index) => (
                <div className="import-row" key={row.id}>
                  <div className="import-row-head">
                    <span>Entry {index + 1}</span>
                    <label className="date-control"><CalendarDays /><span className="sr-only">Entry date</span>
                      <input
                        type="date"
                        value={row.date}
                        max={today()}
                        onChange={(event) => updateImportRow(row.id, 'date', event.target.value)}
                        disabled={importing}
                      />
                    </label>
                    <button
                      className="icon-button remove-row-button"
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
                    rows={4}
                    disabled={importing}
                  />
                </div>
              ))}
            </div>

            <div className="import-actions">
              <button className="ghost-button" onClick={addImportRow} disabled={importing}><Plus /> Add another day</button>
              <button
                className="primary-button large"
                disabled={importing || !importRows.some((row) => row.date && row.text.trim())}
                onClick={startImport}
              >
                {importing ? <span className="button-spinner" /> : <Upload />}
                {importing && importProgress
                  ? `Importing ${Math.min(importProgress.done + 1, importProgress.total)} of ${importProgress.total}...`
                  : `Import ${importRows.filter((row) => row.date && row.text.trim()).length} entries`}
              </button>
            </div>
          </section>
        ) : bookendScreen === 'morning' ? (
          renderMorningBookend()
        ) : bookendScreen === 'day' ? (
          renderDayBookend()
        ) : bookendScreen === 'evening' ? (
          renderEveningBookend()
        ) : generating ? (
          <section className="generating-view" role="status" aria-live="polite">
            <div className="generation-orbit"><Sparkles /></div>
            <h1>{saveVerbatim ? 'Saving your words' : 'Shaping your day into words'}</h1>
            <p>
              {saveVerbatim
                ? 'Keeping your journal exactly as you wrote it.'
                : 'Finding the moments, progress, and threads worth carrying forward.'}
            </p>
            <div className="generation-lines"><span /><span /><span /><span /></div>
          </section>
        ) : activeEntry ? (
          <article className="entry-view">
            <button className="back-to-draft" onClick={() => startNewEntry()}><Plus /> New entry</button>
            <div className="entry-heading">
              <div className="entry-heading-row">
                <div>
                  <div className="eyebrow"><Moon /> Evening reflection</div>
                  {editingDate ? (
                    <div className="date-edit-inline">
                      <input
                        type="date"
                        aria-label="Entry date"
                        value={dateDraft}
                        max={today()}
                        onChange={(event) => setDateDraft(event.target.value)}
                        autoFocus
                      />
                      <button className="ghost-button" disabled={savingDate} onClick={cancelDateEdit}>Cancel</button>
                      <button className="primary-button" disabled={savingDate || !dateDraft} onClick={saveDateEdit}>
                        {savingDate ? <span className="button-spinner" /> : <Check />}
                        {savingDate ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  ) : (
                    <h1>{formatDate(activeEntry.date, true)}</h1>
                  )}
                </div>
                {!editingNarrative && !editingDate && (
                  <div className="entry-heading-actions">
                    <button className="edit-narrative-button" onClick={beginDateEdit}>
                      <CalendarDays /> Edit date
                    </button>
                    <button className="edit-narrative-button" onClick={beginNarrativeEdit}>
                      <Pencil /> Edit reflection
                    </button>
                    <button
                      className="edit-narrative-button delete-entry-button"
                      disabled={deletingEntry}
                      onClick={removeActiveEntry}
                    >
                      <Trash2 /> {deletingEntry ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {showJournalDashboard && activeEntry.praise_message && (activeEntry.completed_goals?.length ?? 0) > 0 && (
              <div className="praise-banner"><span><Sparkles /></span><div><strong>A win worth noticing</strong><p>{activeEntry.praise_message}</p></div></div>
            )}

            {editingNarrative ? (
              <div className="narrative-editor">
                <textarea
                  aria-label="Edit reflection"
                  value={narrativeDraft}
                  onChange={(event) => setNarrativeDraft(event.target.value)}
                  rows={14}
                />
                <div className="narrative-editor-actions">
                  <button className="ghost-button" disabled={savingNarrative} onClick={cancelNarrativeEdit}>
                    Cancel
                  </button>
                  <button
                    className="primary-button"
                    disabled={savingNarrative || !narrativeDraft.trim() || narrativeDraft === activeEntry.formatted_narrative}
                    onClick={saveNarrativeEdit}
                  >
                    {savingNarrative ? <span className="button-spinner" /> : <Check />}
                    {savingNarrative ? 'Saving...' : 'Save changes'}
                  </button>
                </div>
              </div>
            ) : (
              <Narrative text={activeEntry.formatted_narrative} />
            )}

            {showJournalDashboard && renderWorkingOnCard('Looking ahead')}
            {showJournalDashboard && renderWeeklyGoalsCard()}
            {showJournalDashboard && renderNextWeekRemindersCard()}

            {showJournalDashboard && (activeEntry.follow_up_questions?.length ?? 0) > 0 && (
              <section className="follow-ups">
                <div className="follow-up-heading"><Sparkles /><span>Keep reflecting</span></div>
                <h2>A few threads to explore</h2>
                <div className="question-chips">
                  {activeEntry.follow_up_questions?.map((question) => <button key={question} onClick={() => continueThread(activeEntry, question)}><span>{question}</span><ChevronRight /></button>)}
                </div>
              </section>
            )}
          </article>
        ) : (
          <section className="composer">
            <div className="composer-heading">
              <div className="eyebrow"><Moon /> {formatDate(entryDate, true)}</div>
              <h1>{appendTarget ? 'Keep exploring.' : entries.length ? 'Close out your day' : 'Begin with today.'}</h1>
              <p>{appendTarget ? 'Your response will be added to the bottom of the same entry.' : entries.length ? 'Write what happened. Your words are saved exactly as you write them.' : 'No setup, no perfect first sentence. Just tell the story of your day.'}</p>
            </div>
            <div className={listening ? 'editor-card listening' : 'editor-card'}>
              <textarea ref={editorRef} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Today felt..." aria-label="Journal entry" />
              <div className="editor-toolbar">
                <div className="editor-tools">
                  <button className={listening ? 'voice-button active' : 'voice-button'} onClick={toggleVoice}><Mic /> {listening ? 'Listening...' : 'Voice dump'}</button>
                  <label className="date-control"><CalendarDays /><span className="sr-only">Entry date</span><input type="date" value={entryDate} disabled={Boolean(appendTarget)} onChange={(event) => setEntryDate(event.target.value)} /></label>
                </div>
                <span className="word-count">{draft.trim() ? draft.trim().split(/\s+/).length : 0} words</span>
              </div>
            </div>
            <div className="composer-submit">
              <div className="composer-submit-meta">
                <label className="verbatim-toggle">
                  <input
                    type="checkbox"
                    checked={!saveVerbatim}
                    onChange={(event) => setSaveVerbatim(!event.target.checked)}
                  />
                  <span>Use AI rewrite</span>
                </label>
                <p>
                  {saveVerbatim ? (
                    <>Your entry will be saved word for word. Reminders and tasks in your text can still be picked up.</>
                  ) : (
                    <><Sparkles /> AI will polish your entry and help you reflect.</>
                  )}
                </p>
              </div>
              <button className="primary-button large" disabled={!draft.trim() || !userId} onClick={submitEntry}>{appendTarget ? 'Add to this entry' : saveVerbatim ? 'Save to my journal' : 'Reflect on my day'} <ChevronRight /></button>
            </div>
            {renderWorkingOnCard('Keep in mind as you write')}
            {renderWeeklyGoalsCard()}
            {renderNextWeekRemindersCard()}
          </section>
        )}
      </main>
    </div>
  )
}

export default App
