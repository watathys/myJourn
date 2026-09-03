import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import {
  acknowledgeTaskSnooze, addToCalendarNaturalLanguage, chatWithPercy, createGoalWithPercy, createPercyReminder, createSavedPercyAdvice,
  createSection, createSpellingCorrection, createTask, createWeeklyGoal, deleteJournalEntry,
  deletePercyReminder, deleteSavedPercyAdvice, deleteSection, deleteSpellingCorrection, disconnectGoogle, dismissLifeInsight,
  dismissPercyReminder, finishWeeklyPlanning, generateWeeklyReflection, getDailyPlan,
  getEntries, getGoogleAuthorizeUrl, getGoogleStatus, getLifeInsights, getNorthStar, getPercyReminders,
  getSavedPercyAdvice, getSections, getSpellingCorrections, getTasks, getWeeklyGoals, getWeeklyPlanningSession,
  markLifeInsightRead, processEntry, reorderGoals, reorderSections, reorderTasks, saveDailyPlan, saveNorthStar,
  startWeeklyPlanning, updateGoal, updateJournalEntry, updateSection, updateTask,
  type DailyPlan, type Goal, type GoalUpdate, type GoogleStatus, type JournalEntry, type LifeInsight,
  type PercyChatMessage, type PercyReminder, type SavedPercyAdvice, type SpellingCorrection, type Task,
  type TaskSection, type TaskUpdate, type WeeklyPlanningSession,
} from '../api'
import { supabase } from '../supabase'
import {
  addDaysToIsoDate, combineToRemindAt, currentTime, dayPhase, durationMinutesFromTimes,
  isAutoDarkModeTime, journalDay, weekAgo, weekStartOf, type DayPhase,
} from '../lib/day'
import { compareEntries, isMobileViewport, sortWorkingTasks } from '../lib/entries'
import { makeRowId, parseBulkEntries, type ImportRow } from '../lib/import'

const DRAFT_KEY = 'myjourn_entry_draft'
const DRAFT_DATE_KEY = 'myjourn_entry_date'
const VERBATIM_KEY = 'myjourn_save_verbatim'
const THEME_KEY = 'myjourn_theme_mode'

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return 'Unable to connect to server'
}

function getCached<T>(key: string, fallback: T): T {
  try {
    const item = localStorage.getItem(key)
    return item ? (JSON.parse(item) as T) : fallback
  } catch {
    return fallback
  }
}

function setCached<T>(key: string, value: T): void {
  try {
    if (value === null || value === undefined) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, JSON.stringify(value))
    }
  } catch {
    // Ignore quota or private storage errors
  }
}

export type PanelId = 'journal' | 'weekly' | 'percy' | 'settings'
export type PageId = 'home' | 'write'
export type ThemeMode = 'auto' | 'light' | 'dark'

/** What the day panel on the home screen is asking the user to do right now. */
export type DayState = 'plan' | 'focus' | 'reflect' | 'closed'

export type ScheduleTarget = {
  item: Task | Goal
  targetType: 'task' | 'goal'
  mode: 'reminder' | 'snooze'
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

export function useJournalState() {
  const [sessionUser, setSessionUser] = useState<{ id: string; email?: string } | null>(null)
  const [authChecking, setAuthChecking] = useState(true)
  const [userId, setUserId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // Navigation: main page (home/write), panels and reader overlays.
  const [activePage, setActivePage] = useState<PageId>('home')
  const [panel, setPanel] = useState<PanelId | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [activeEntry, setActiveEntry] = useState<JournalEntry | null>(null)

  // Journal data
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [sections, setSections] = useState<TaskSection[]>([])
  const [weeklyGoals, setWeeklyGoals] = useState<Goal[]>([])
  const [lastWeekGoals, setLastWeekGoals] = useState<Goal[]>([])
  const [percyReminders, setPercyReminders] = useState<PercyReminder[]>([])
  const [lifeInsights, setLifeInsights] = useState<LifeInsight[]>([])
  const [savedPercyAdvice, setSavedPercyAdvice] = useState<SavedPercyAdvice[]>([])
  const [spellingCorrections, setSpellingCorrections] = useState<SpellingCorrection[]>([])
  const [dailyPlan, setDailyPlan] = useState<DailyPlan | null>(null)
  const [northStar, setNorthStar] = useState('')
  const [savedNorthStar, setSavedNorthStar] = useState('')
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null)

  // Theme
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark' || saved === 'auto') return saved
    return 'auto'
  })

  // Composer
  const [draft, setDraft] = useState(() => localStorage.getItem(DRAFT_KEY) ?? '')
  const [entryDate, setEntryDate] = useState(
    () => (localStorage.getItem(DRAFT_KEY) ? localStorage.getItem(DRAFT_DATE_KEY) ?? journalDay() : journalDay()),
  )
  const [saveVerbatim, setSaveVerbatim] = useState(() => localStorage.getItem(VERBATIM_KEY) !== '0')
  const [appendTarget, setAppendTarget] = useState<{ id: string; date: string } | null>(null)
  const [generating, setGenerating] = useState(false)
  const [listening, setListening] = useState(false)

  // Entry reader
  const [editingNarrative, setEditingNarrative] = useState(false)
  const [narrativeDraft, setNarrativeDraft] = useState('')
  const [savingNarrative, setSavingNarrative] = useState(false)
  const [editingDate, setEditingDate] = useState(false)
  const [dateDraft, setDateDraft] = useState('')
  const [savingDate, setSavingDate] = useState(false)
  const [deletingEntry, setDeletingEntry] = useState(false)
  const [search, setSearch] = useState('')

  // Day panel
  const [clockMs, setClockMs] = useState(() => Date.now())
  const [morningSelectedIds, setMorningSelectedIds] = useState<string[]>([])
  const [savingMorningPlan, setSavingMorningPlan] = useState(false)
  const [planEditing, setPlanEditing] = useState(false)
  const [dayPanelCollapsed, setDayPanelCollapsed] = useState(false)

  // Tasks
  const [newTaskDraft, setNewTaskDraft] = useState('')
  const [newTaskStartTime, setNewTaskStartTime] = useState('')
  const [newTaskEndTime, setNewTaskEndTime] = useState('')
  const [newTaskSectionId, setNewTaskSectionId] = useState('')
  const [addingTask, setAddingTask] = useState(false)
  const [taskFormOpen, setTaskFormOpen] = useState(false)
  const [snoozedOpen, setSnoozedOpen] = useState(false)
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null)
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [taskDropTarget, setTaskDropTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null)

  // Task sections
  const [sectionFormOpen, setSectionFormOpen] = useState(false)
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null)
  const [newSectionName, setNewSectionName] = useState('')
  const [newSectionColor, setNewSectionColor] = useState('forest')
  const [addingSection, setAddingSection] = useState(false)
  const [sectionDropTarget, setSectionDropTarget] = useState<string | 'unsectioned' | null>(null)
  const [draggedSectionId, setDraggedSectionId] = useState<string | null>(null)
  const [sectionReorderTarget, setSectionReorderTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null)
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('myjourn_collapsed_sections')
      return saved ? (JSON.parse(saved) as string[]) : []
    } catch {
      return []
    }
  })

  // Goals
  const [newGoalDraft, setNewGoalDraft] = useState('')
  const [newGoalTargetCount, setNewGoalTargetCount] = useState(1)
  const [addingGoal, setAddingGoal] = useState(false)
  const [goalFormOpen, setGoalFormOpen] = useState(false)
  const [updatingGoalId, setUpdatingGoalId] = useState<string | null>(null)
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null)
  const [editGoalText, setEditGoalText] = useState('')
  const [editGoalTarget, setEditGoalTarget] = useState(1)
  const [draggedGoalId, setDraggedGoalId] = useState<string | null>(null)
  const [goalDropTarget, setGoalDropTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null)

  // Reminders
  const [newReminderDraft, setNewReminderDraft] = useState('')
  const [addingReminder, setAddingReminder] = useState(false)
  const [dismissingReminderId, setDismissingReminderId] = useState<string | null>(null)

  // Scheduling
  const [scheduleTarget, setScheduleTarget] = useState<ScheduleTarget | null>(null)
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [connectingGoogle, setConnectingGoogle] = useState(false)
  const [addingCalendarBatch, setAddingCalendarBatch] = useState(false)

  // Weekly planning
  const [weeklySession, setWeeklySession] = useState<WeeklyPlanningSession | null>(null)
  const [weeklySessionChecked, setWeeklySessionChecked] = useState(false)
  const [weeklyLoading, setWeeklyLoading] = useState(false)
  const [startingWeeklyPlanning, setStartingWeeklyPlanning] = useState(false)
  const [finishingWeeklyPlanning, setFinishingWeeklyPlanning] = useState(false)
  const [generatingReflection, setGeneratingReflection] = useState(false)

  // Percy
  const [chatMessages, setChatMessages] = useState<PercyChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [savingAdviceIndex, setSavingAdviceIndex] = useState<number | null>(null)
  const [deletingAdviceId, setDeletingAdviceId] = useState<string | null>(null)
  const [activeChatInsight, setActiveChatInsight] = useState<{ id?: string; text: string } | null>(null)
  const [activeChatThread, setActiveChatThread] = useState<{ question: string; date: string; entryId?: string } | null>(null)
  const [percyGoalQuery, setPercyGoalQuery] = useState('')
  const [creatingPercyGoal, setCreatingPercyGoal] = useState(false)
  const [percyGoalReply, setPercyGoalReply] = useState('')

  // Settings
  const [savingSettings, setSavingSettings] = useState(false)
  const [newIncorrectDraft, setNewIncorrectDraft] = useState('')
  const [newCorrectDraft, setNewCorrectDraft] = useState('')
  const [addingCorrection, setAddingCorrection] = useState(false)
  const [deletingCorrectionId, setDeletingCorrectionId] = useState<string | null>(null)

  // Import
  const [importRows, setImportRows] = useState<ImportRow[]>([{ id: makeRowId(), date: '', text: '' }])
  const [importBulkText, setImportBulkText] = useState('')
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null)

  const editorRef = useRef<HTMLTextAreaElement>(null)
  const entryListRef = useRef<HTMLDivElement>(null)
  const percyChatRef = useRef<HTMLDivElement>(null)
  const percyInputRef = useRef<HTMLInputElement>(null)
  const speechRef = useRef<SpeechRecognitionLike | null>(null)
  const lastLoadedUserIdRef = useRef<string | null>(null)

  /* ---------------------------------------------------------------- derived */

  const clockDate = useMemo(() => currentTime(new Date(clockMs)), [clockMs])
  const todayIso = useMemo(() => journalDay(clockDate), [clockDate])
  const phase: DayPhase = useMemo(() => dayPhase(clockDate), [clockDate])
  const weekStart = useMemo(() => weekStartOf(todayIso), [todayIso])
  const isNightTime = useMemo(() => isAutoDarkModeTime(clockDate), [clockDate])

  const isDarkMode = useMemo(() => {
    if (themeMode === 'dark') return true
    if (themeMode === 'light') return false
    return isNightTime
  }, [themeMode, isNightTime])

  const visibleTasks = useMemo(
    () => sortWorkingTasks(tasks.filter((task) => !task.is_snoozed)),
    [tasks],
  )
  const snoozedTasks = useMemo(
    () => tasks.filter((task) => task.is_snoozed && task.status !== 'abandoned'),
    [tasks],
  )
  const openGoals = useMemo(
    () => weeklyGoals.filter((goal) => goal.status !== 'abandoned'),
    [weeklyGoals],
  )

  const plannedTasks = useMemo(() => {
    if (!dailyPlan?.selected_task_ids.length) return []
    const allItems = [...tasks, ...(weeklyGoals as unknown as Task[])]
    const byId = new Map(allItems.map((item) => [item.id, item]))
    return dailyPlan.selected_task_ids
      .map((id) => byId.get(id))
      .filter((task): task is Task => task !== undefined && task.status !== 'abandoned')
  }, [dailyPlan, tasks, weeklyGoals])

  const plannedIds = useMemo(() => new Set(plannedTasks.map((task) => task.id)), [plannedTasks])
  const backlogTasks = useMemo(
    () => visibleTasks.filter((task) => !plannedIds.has(task.id)),
    [visibleTasks, plannedIds],
  )

  const planCompleted = Boolean(dailyPlan?.morning_completed_at && dailyPlan.date === todayIso)

  const todayEntry = useMemo(
    () => entries.find((entry) => entry.date === todayIso) ?? null,
    [entries, todayIso],
  )

  const dayState: DayState = useMemo(() => {
    if (phase === 'day') return planEditing || !planCompleted ? 'plan' : 'focus'
    if (planEditing) return 'plan'
    return todayEntry ? 'closed' : 'reflect'
  }, [phase, planEditing, planCompleted, todayEntry])

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

  const unreadInsightCount = useMemo(
    () => lifeInsights.filter((insight) => !insight.is_read).length,
    [lifeInsights],
  )

  const doneTodayCount = plannedTasks.filter((task) => task.status === 'completed').length

  /* ------------------------------------------------------------ data loading */

  const loadUserData = async (id: string, force = false) => {
    if (!force && lastLoadedUserIdRef.current === id) return
    lastLoadedUserIdRef.current = id
    setUserId(id)

    // Hydrate user-scoped cache if current state is empty
    const cachedTasks = getCached<Task[]>(`myjourn_cache_${id}_tasks`, [])
    const cachedEntries = getCached<JournalEntry[]>(`myjourn_cache_${id}_entries`, [])
    const cachedSections = getCached<TaskSection[]>(`myjourn_cache_${id}_sections`, [])
    const cachedPlan = getCached<DailyPlan | null>(`myjourn_cache_${id}_daily_plan`, null)
    const cachedGoals = getCached<Goal[]>(`myjourn_cache_${id}_weekly_goals`, [])
    const cachedNorthStar = getCached<string>(`myjourn_cache_${id}_north_star`, '')

    if (tasks.length === 0 && cachedTasks.length > 0) setTasks(cachedTasks)
    if (entries.length === 0 && cachedEntries.length > 0) setEntries(cachedEntries)
    if (sections.length === 0 && cachedSections.length > 0) setSections(cachedSections)
    if (!dailyPlan && cachedPlan) {
      setDailyPlan(cachedPlan)
      setMorningSelectedIds(cachedPlan.selected_task_ids ?? [])
    }
    if (weeklyGoals.length === 0 && cachedGoals.length > 0) setWeeklyGoals(cachedGoals)
    if (!northStar && cachedNorthStar) {
      setNorthStar(cachedNorthStar)
      setSavedNorthStar(cachedNorthStar)
    }

    const hasData = Boolean(
      tasks.length > 0 || cachedTasks.length > 0 ||
      dailyPlan !== null || cachedPlan !== null ||
      sections.length > 0 || cachedSections.length > 0 ||
      entries.length > 0 || cachedEntries.length > 0
    )

    if (!hasData) {
      setLoading(true)
    }

    try {
      const day = journalDay()
      const results = await Promise.allSettled([
        getEntries(id),
        getNorthStar(id),
        getLifeInsights(id),
        getTasks(id),
        getWeeklyGoals(id, weekStartOf(day)),
        getSpellingCorrections(id),
        getPercyReminders(id),
        getDailyPlan(id, day),
        getSavedPercyAdvice(id),
        getSections(id),
      ])

      const [
        historyRes,
        missionRes,
        insightsRes,
        taskListRes,
        goalsRes,
        correctionsRes,
        remindersRes,
        planRes,
        adviceRes,
        sectionsRes,
      ] = results

      const errors: string[] = []

      if (historyRes.status === 'fulfilled') {
        setEntries(historyRes.value)
      } else {
        errors.push(`Journal Entries: ${getErrorMessage(historyRes.reason)}`)
      }

      if (missionRes.status === 'fulfilled') {
        setNorthStar(missionRes.value)
        setSavedNorthStar(missionRes.value)
      }

      if (insightsRes.status === 'fulfilled') setLifeInsights(insightsRes.value)

      if (taskListRes.status === 'fulfilled') {
        setTasks(taskListRes.value)
      } else {
        errors.push(`Tasks: ${getErrorMessage(taskListRes.reason)}`)
      }

      if (goalsRes.status === 'fulfilled') setWeeklyGoals(goalsRes.value)
      if (correctionsRes.status === 'fulfilled') setSpellingCorrections(correctionsRes.value)
      if (remindersRes.status === 'fulfilled') setPercyReminders(remindersRes.value)

      if (planRes.status === 'fulfilled') {
        setDailyPlan(planRes.value)
        setMorningSelectedIds(planRes.value?.selected_task_ids ?? [])
      }

      if (adviceRes.status === 'fulfilled') setSavedPercyAdvice(adviceRes.value)
      if (sectionsRes.status === 'fulfilled') setSections(sectionsRes.value)

      getGoogleStatus(id).then(setGoogleStatus).catch(() => {})

      if (errors.length > 0 && !hasData) {
        setError(errors[0])
      } else if (results.every((r) => r.status === 'fulfilled')) {
        setError('')
      }
    } catch (reason: unknown) {
      if (!hasData) {
        setError(getErrorMessage(reason))
      }
    } finally {
      setLoading(false)
    }
  }

  async function refreshBackgroundState() {
    if (!userId) return
    try {
      const results = await Promise.allSettled([
        getPercyReminders(userId),
        getLifeInsights(userId),
        getWeeklyGoals(userId, weekStartOf(journalDay())),
        getTasks(userId),
        getDailyPlan(userId, journalDay()),
        getSections(userId),
      ])
      if (results[0].status === 'fulfilled') setPercyReminders(results[0].value)
      if (results[1].status === 'fulfilled') setLifeInsights(results[1].value)
      if (results[2].status === 'fulfilled') setWeeklyGoals(results[2].value)
      if (results[3].status === 'fulfilled') setTasks(results[3].value)
      if (results[4].status === 'fulfilled') setDailyPlan(results[4].value)
      if (results[5].status === 'fulfilled') setSections(results[5].value)
    } catch {
      // Best-effort background refresh; everything reappears on the next visit.
    }
  }

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return
      if (session?.user) {
        setSessionUser({ id: session.user.id, email: session.user.email })
        setUserId(session.user.id)
        loadUserData(session.user.id)
      } else {
        setSessionUser(null)
        setUserId('')
        setLoading(false)
      }
      setAuthChecking(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      if (session?.user) {
        setSessionUser({ id: session.user.id, email: session.user.email })
        setUserId(session.user.id)
        loadUserData(session.user.id)
      } else {
        setSessionUser(null)
        setUserId('')
        lastLoadedUserIdRef.current = null
        setLoading(false)
      }
      setAuthChecking(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const connected = params.get('google')
    const googleError = params.get('google_error')
    if (connected || googleError) {
      if (connected && userId) {
        getGoogleStatus(userId).then(setGoogleStatus).catch(() => {})
      }
      setNotice(
        connected
          ? 'Google Calendar connected. Scheduled reminders will now appear on your calendar.'
          : 'Could not connect Google Calendar. Please try again.',
      )
      params.delete('google')
      params.delete('google_error')
      const rest = params.toString()
      window.history.replaceState({}, '', rest ? `${window.location.pathname}?${rest}` : window.location.pathname)
    }
  }, [userId])

  // The clock drives the day phase, so keep it fresh while the tab sits open.
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

  // Reload the plan when the journal day rolls over at 5am.
  useEffect(() => {
    if (!userId) return
    if (dailyPlan && dailyPlan.date === todayIso) return
    let mounted = true
    getDailyPlan(userId, todayIso)
      .then((plan) => {
        if (!mounted) return
        setDailyPlan(plan)
        setMorningSelectedIds(plan?.selected_task_ids ?? [])
        setPlanEditing(false)
      })
      .catch(() => {})
    return () => { mounted = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, todayIso])

  useEffect(() => {
    if (panel !== 'percy' || !userId || unreadInsightCount === 0) return
    const unread = lifeInsights.filter((insight) => !insight.is_read)
    setLifeInsights((current) => current.map((insight) => ({ ...insight, is_read: true })))
    Promise.all(unread.map((insight) => markLifeInsightRead(userId, insight.id))).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, userId])

  useEffect(() => {
    if (panel !== 'weekly' || !userId) return
    let mounted = true
    setWeeklyLoading(true)
    setWeeklySessionChecked(false)
    getWeeklyPlanningSession(userId, weekStart)
      .then((existingSession) => {
        if (!mounted) return
        setWeeklySession(existingSession)
        setWeeklySessionChecked(true)
        if (!existingSession) return
        return Promise.all([
          getPercyReminders(userId),
          getTasks(userId),
          getWeeklyGoals(userId, weekStart),
          getWeeklyGoals(userId, addDaysToIsoDate(weekStart, -7)),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, userId, weekStart])

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
    localStorage.setItem(THEME_KEY, themeMode)
  }, [themeMode])

  useEffect(() => {
    localStorage.setItem('myjourn_collapsed_sections', JSON.stringify(collapsedSectionIds))
  }, [collapsedSectionIds])

  // Sync data state to LocalStorage cache (user-scoped)
  useEffect(() => { if (userId && entries.length > 0) setCached(`myjourn_cache_${userId}_entries`, entries) }, [userId, entries])
  useEffect(() => { if (userId && tasks.length > 0) setCached(`myjourn_cache_${userId}_tasks`, tasks) }, [userId, tasks])
  useEffect(() => { if (userId && sections.length > 0) setCached(`myjourn_cache_${userId}_sections`, sections) }, [userId, sections])
  useEffect(() => { if (userId && weeklyGoals.length > 0) setCached(`myjourn_cache_${userId}_weekly_goals`, weeklyGoals) }, [userId, weeklyGoals])
  useEffect(() => { if (userId && dailyPlan) setCached(`myjourn_cache_${userId}_daily_plan`, dailyPlan) }, [userId, dailyPlan])
  useEffect(() => { if (userId && northStar) setCached(`myjourn_cache_${userId}_north_star`, northStar) }, [userId, northStar])

  useEffect(() => {
    const root = document.documentElement
    if (isDarkMode) {
      root.setAttribute('data-theme', 'dark')
      root.classList.add('dark')
    } else {
      root.setAttribute('data-theme', 'light')
      root.classList.remove('dark')
    }
  }, [isDarkMode])

  function toggleThemeMode() {
    if (themeMode === 'auto') {
      setThemeMode(isDarkMode ? 'light' : 'dark')
    } else if (themeMode === 'dark') {
      setThemeMode('light')
    } else {
      setThemeMode('dark')
    }
  }

  /* -------------------------------------------------------------- navigation */

  function goHome() {
    setActivePage('home')
    setPanel(null)
    setActiveEntry(null)
    setEditingNarrative(false)
    setEditingDate(false)
  }

  function openPanel(id: PanelId) {
    setPanel(id)
  }

  function closePanel() {
    setPanel(null)
  }

  function openComposer(options: { prefill?: string; date?: string; append?: { id: string; date: string } } = {}) {
    setActiveEntry(null)
    setEditingNarrative(false)
    setEditingDate(false)
    setPanel(null)
    setError('')
    if (options.prefill !== undefined) setDraft(options.prefill)
    setEntryDate(options.date ?? options.append?.date ?? journalDay())
    setAppendTarget(options.append ?? null)
    setComposerOpen(true)
    setActivePage('write')
    requestAnimationFrame(() => editorRef.current?.focus())
  }

  function closeComposer() {
    setComposerOpen(false)
    setAppendTarget(null)
    if (listening) {
      speechRef.current?.stop()
      setListening(false)
    }
  }

  function openEntry(entry: JournalEntry) {
    setActiveEntry(entry)
    setNarrativeDraft(entry.formatted_narrative)
    setEditingNarrative(false)
    setEditingDate(false)
    setComposerOpen(false)
    if (isMobileViewport()) setPanel(null)
  }

  function closeEntry() {
    setActiveEntry(null)
    setEditingNarrative(false)
    setEditingDate(false)
  }

  function continueThread(entry: JournalEntry, question: string) {
    closeEntry()
    setActiveChatInsight(null)
    setActiveChatThread({ question, date: entry.date, entryId: entry.id })
    setChatMessages([{ role: 'assistant', content: question }])
    setPanel('percy')
    setTimeout(() => {
      percyChatRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      percyInputRef.current?.focus()
    }, 60)
  }

  /* ------------------------------------------------------------- day planning */

  function toggleMorningTask(taskId: string) {
    setMorningSelectedIds((current) =>
      current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId],
    )
  }

  async function saveDayPlan(selectedIds: string[]) {
    if (!userId || savingMorningPlan) return
    setSavingMorningPlan(true)
    setError('')
    try {
      const plan = await saveDailyPlan(userId, todayIso, selectedIds, true)
      setDailyPlan(plan)
      setMorningSelectedIds(plan.selected_task_ids)
      setPlanEditing(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save your plan for today.')
    } finally {
      setSavingMorningPlan(false)
    }
  }

  function startEditingPlan() {
    setMorningSelectedIds(dailyPlan?.selected_task_ids ?? [])
    setPlanEditing(true)
  }

  /* -------------------------------------------------------------- journaling */

  async function submitEntry() {
    if (!draft.trim() || !userId || generating) return
    setGenerating(true)
    setError('')
    try {
      const created = await processEntry(
        userId, entryDate, draft.trim(), false, appendTarget?.id, saveVerbatim,
      )
      const [refreshedEntries, refreshedTasks] = await Promise.all([getEntries(userId), getTasks(userId)])
      const savedEntry = refreshedEntries.find((entry) => entry.id === created.id) ?? created
      setEntries(refreshedEntries)
      setTasks(refreshedTasks)
      setDraft('')
      setAppendTarget(null)
      setComposerOpen(false)
      setActiveEntry(savedEntry)
      setNarrativeDraft(savedEntry.formatted_narrative)
      setEditingNarrative(false)
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
      setEntries((current) => current.map((entry) => (entry.id === nextEntry.id ? { ...entry, ...nextEntry } : entry)))
      setEditingNarrative(false)
      setNarrativeDraft(updated.formatted_narrative)
      refreshSpellingCorrections()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save your edits.')
    } finally {
      setSavingNarrative(false)
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

  async function removeActiveEntry() {
    if (!userId || !activeEntry || deletingEntry) return
    if (!window.confirm('Delete this journal entry permanently?')) return
    setDeletingEntry(true)
    setError('')
    try {
      await deleteJournalEntry(userId, activeEntry.id)
      const [refreshedEntries, refreshedTasks] = await Promise.all([getEntries(userId), getTasks(userId)])
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

  /* ------------------------------------------------------------------- tasks */

  async function addManualTask() {
    const clean = newTaskDraft.trim()
    if (!userId || !clean || addingTask) return
    setAddingTask(true)
    setError('')
    try {
      const options: { remind_at?: string; duration_minutes?: number; section_id?: string } = {}
      if (newTaskStartTime) {
        options.remind_at = combineToRemindAt(todayIso, newTaskStartTime)
        if (newTaskEndTime) {
          const duration = durationMinutesFromTimes(newTaskStartTime, newTaskEndTime)
          if (duration != null) options.duration_minutes = duration
        }
      }
      const sectionId = newTaskSectionId.trim()
      if (sectionId) options.section_id = sectionId
      const task = await createTask(userId, clean, options)
      setTasks((current) => sortWorkingTasks([...current, task]))
      if (planEditing) {
        setMorningSelectedIds((current) => (current.includes(task.id) ? current : [...current, task.id]))
      }
      setNewTaskDraft('')
      setNewTaskStartTime('')
      setNewTaskEndTime('')
      setNewTaskSectionId('')
      if (options.remind_at) {
        if (!googleStatus?.connected) {
          setNotice('Task saved — connect Google Calendar in Settings so timed tasks appear there.')
        } else if (!task.has_calendar_reminder) {
          setError('Task saved, but it couldn’t be added to Google Calendar. Try reconnecting Google in Settings.')
        } else {
          setNotice('Added to your Google Calendar.')
        }
      }
      refreshBackgroundState()
      return task
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to add that task.')
    } finally {
      setAddingTask(false)
    }
  }

  async function patchTask(task: Task, updates: TaskUpdate): Promise<Task | undefined> {
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
      setTasks((current) => sortWorkingTasks(current.map((item) => (item.id === task.id ? optimistic : item))))
      setError('')
      try {
        const updated = await updateTask(userId, task.id, { current_count })
        setTasks((current) => sortWorkingTasks(current.map((item) => (item.id === task.id ? updated : item))))
        return updated
      } catch (reason) {
        setTasks((current) => sortWorkingTasks(current.map((item) => (item.id === task.id ? task : item))))
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
      // Non-fatal: the highlight clears next time the task list refreshes.
    }
  }

  function clearTaskDrag() {
    setDraggedTaskId(null)
    setTaskDropTarget(null)
    setSectionDropTarget(null)
    setSectionReorderTarget(null)
  }

  function handleTaskDragStart(event: DragEvent, taskId: string) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', taskId)
    setDraggedTaskId(taskId)
    setDraggedSectionId(null)
    setTaskDropTarget(null)
    setSectionDropTarget(null)
    setSectionReorderTarget(null)
  }

  function handleTaskDragOver(event: DragEvent, taskId: string) {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setSectionDropTarget(null)
    setSectionReorderTarget(null)
    if (!draggedTaskId || draggedTaskId === taskId) {
      setTaskDropTarget(null)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setTaskDropTarget((current) => (
      current?.id === taskId && current.position === position ? current : { id: taskId, position }
    ))
  }

  async function handleTaskDrop(targetId: string, position: 'before' | 'after') {
    if (!userId || !draggedTaskId || draggedTaskId === targetId) {
      clearTaskDrag()
      return
    }
    const target = tasks.find((task) => task.id === targetId)
    const dragged = tasks.find((task) => task.id === draggedTaskId)
    if (!target || !dragged) {
      clearTaskDrag()
      return
    }
    const sectionKey = target.section_id ?? null
    // Tasks currently in the target's section (in display order), minus the dragged one.
    const order = visibleTasks
      .filter((task) => (task.section_id ?? null) === sectionKey && task.id !== draggedTaskId)
      .map((task) => task.id)
    const targetIndex = order.indexOf(targetId)
    if (targetIndex === -1) {
      clearTaskDrag()
      return
    }
    order.splice(targetIndex + (position === 'after' ? 1 : 0), 0, draggedTaskId)
    const movingSections = (dragged.section_id ?? null) !== sectionKey
    clearTaskDrag()

    const byId = new Map(tasks.map((task) => [task.id, task]))
    setTasks((current) => {
      const reordered = order.map((id) => byId.get(id)).filter((task): task is Task => Boolean(task))
      const rest = current.filter((task) => !order.includes(task.id))
      return [...reordered, ...rest]
    })
    try {
      if (movingSections) {
        await updateTask(userId, draggedTaskId, { section_id: sectionKey })
      }
      const updated = await reorderTasks(userId, order)
      setTasks((current) => {
        const byUpdatedId = new Map(updated.map((task) => [task.id, task]))
        return current.map((task) => byUpdatedId.get(task.id) ?? task)
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to reorder your tasks.')
    }
  }

  /* ---------------------------------------------------------- task sections */

  function toggleSectionCollapsed(sectionId: string) {
    setCollapsedSectionIds((current) => (
      current.includes(sectionId)
        ? current.filter((id) => id !== sectionId)
        : [...current, sectionId]
    ))
  }

  function openSectionForm() {
    setSectionFormOpen(true)
    setEditingSectionId(null)
    setNewSectionName('')
    setNewSectionColor('forest')
  }

  function startEditingSection(section: TaskSection) {
    setEditingSectionId(section.id)
    setSectionFormOpen(false)
    setNewSectionName(section.name)
    setNewSectionColor(section.color)
  }

  function cancelSectionEdit() {
    setEditingSectionId(null)
    setSectionFormOpen(false)
    setNewSectionName('')
  }

  async function addSection(name: string, color: string) {
    const clean = name.trim()
    if (!userId || !clean || addingSection) return
    setAddingSection(true)
    setError('')
    try {
      const created = await createSection(userId, clean, color)
      setSections((current) => [...current, created])
      setNewSectionName('')
      setSectionFormOpen(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to add that section.')
    } finally {
      setAddingSection(false)
    }
  }

  async function saveSectionEdit(sectionId: string, name: string, color: string) {
    const clean = name.trim()
    if (!userId || !clean) return
    setError('')
    try {
      const updated = await updateSection(userId, sectionId, {
        name: clean,
        color,
      })
      setSections((current) => current.map((section) => (section.id === sectionId ? updated : section)))
      setEditingSectionId(null)
      setNewSectionName('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update that section.')
    }
  }

  async function removeSection(sectionId: string) {
    if (!userId) return
    setError('')
    try {
      await deleteSection(userId, sectionId)
      setSections((current) => current.filter((section) => section.id !== sectionId))
      // Tasks in the deleted section fall back to the unsectioned group.
      setTasks((current) => current.map((task) => (
        task.section_id === sectionId ? { ...task, section_id: null } : task
      )))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to delete that section.')
    }
  }

  function clearSectionReorderDrag() {
    setDraggedSectionId(null)
    setSectionReorderTarget(null)
  }

  function handleSectionReorderDragStart(event: DragEvent, sectionId: string) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', `section:${sectionId}`)
    setDraggedSectionId(sectionId)
    setDraggedTaskId(null)
    setSectionReorderTarget(null)
    setTaskDropTarget(null)
    setSectionDropTarget(null)
  }

  function handleSectionDragOver(event: DragEvent, key: string | 'unsectioned') {
    // Reordering a section: only real sections are valid drop targets.
    if (draggedSectionId) {
      if (key === 'unsectioned' || draggedSectionId === key) {
        setSectionReorderTarget(null)
        return
      }
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setTaskDropTarget(null)
      setSectionDropTarget(null)
      const rect = event.currentTarget.getBoundingClientRect()
      const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
      setSectionReorderTarget((current) => (
        current?.id === key && current.position === position ? current : { id: key, position }
      ))
      return
    }
    // Dropping a task into a section.
    if (!draggedTaskId) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setTaskDropTarget(null)
    setSectionReorderTarget(null)
    setSectionDropTarget((current) => (current === key ? current : key))
  }

  function handleSectionDrop(key: string | 'unsectioned') {
    if (draggedSectionId) {
      if (sectionReorderTarget && sectionReorderTarget.id === key) {
        void handleSectionReorderDrop(key, sectionReorderTarget.position)
      } else {
        clearSectionReorderDrag()
      }
      return
    }
    if (!draggedTaskId || sectionDropTarget !== key) {
      clearTaskDrag()
      return
    }
    const taskId = draggedTaskId
    const sectionId = key === 'unsectioned' ? null : key
    clearTaskDrag()
    void moveTaskToSection(taskId, sectionId)
  }

  async function handleSectionReorderDrop(targetId: string, position: 'before' | 'after') {
    if (!userId || !draggedSectionId || draggedSectionId === targetId) {
      clearSectionReorderDrag()
      return
    }
    const order = sections.map((section) => section.id)
    const fromIndex = order.indexOf(draggedSectionId)
    if (fromIndex === -1 || !order.includes(targetId)) {
      clearSectionReorderDrag()
      return
    }
    order.splice(fromIndex, 1)
    let insertIndex = order.indexOf(targetId)
    if (position === 'after') insertIndex += 1
    order.splice(insertIndex, 0, draggedSectionId)
    clearSectionReorderDrag()

    const byId = new Map(sections.map((section) => [section.id, section]))
    setSections(order.map((id) => byId.get(id)).filter((section): section is TaskSection => Boolean(section)))
    try {
      const updated = await reorderSections(userId, order)
      setSections(updated)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to reorder your sections.')
      setSections(sections)
    }
  }

  async function moveTaskToSection(taskId: string, sectionId: string | null) {
    if (!userId) return
    const task = tasks.find((item) => item.id === taskId)
    if (!task || (task.section_id ?? null) === sectionId) return
    try {
      const updated = await patchTask(task, { section_id: sectionId })
      if (!updated) return
      // Keep the moved task at the end of its new section.
      const sectionOrder = visibleTasks
        .filter((item) => (item.section_id ?? null) === sectionId && item.id !== taskId)
        .map((item) => item.id)
      sectionOrder.push(taskId)
      const reordered = await reorderTasks(userId, sectionOrder)
      setTasks((current) => {
        const byId = new Map(reordered.map((item) => [item.id, item]))
        return current.map((item) => byId.get(item.id) ?? item)
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to move that task.')
    }
  }

  /* ------------------------------------------------------------------- goals */

  async function addWeeklyGoal() {
    const clean = newGoalDraft.trim()
    if (!userId || !clean || addingGoal) return
    setAddingGoal(true)
    setError('')
    try {
      const goal = await createWeeklyGoal(userId, clean, weekStart, newGoalTargetCount)
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
      const apply = (goals: Goal[]) => goals.map((item) => (item.id === goal.id ? next : item))
      setWeeklyGoals(apply)
      setLastWeekGoals(apply)
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
      const apply = (goals: Goal[]) => (
        status === 'abandoned'
          ? goals.filter((item) => item.id !== goal.id)
          : goals.map((item) => (item.id === goal.id ? updated : item))
      )
      setWeeklyGoals(apply)
      setLastWeekGoals(apply)
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
      const apply = (goals: Goal[]) => goals.map((item) => (item.id === goal.id ? updated : item))
      setWeeklyGoals(apply)
      setLastWeekGoals(apply)
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
      current?.id === goalId && current.position === position ? current : { id: goalId, position }
    ))
  }

  async function handleGoalDrop(targetId: string, position: 'before' | 'after') {
    if (!userId || !draggedGoalId || draggedGoalId === targetId) {
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
      const updated = await reorderGoals(userId, weekStart, order)
      setWeeklyGoals((current) => {
        const byUpdatedId = new Map(updated.map((goal) => [goal.id, goal]))
        return current.map((goal) => byUpdatedId.get(goal.id) ?? goal)
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to reorder your goals.')
    }
  }

  /* --------------------------------------------------------------- reminders */

  async function addReminder() {
    const clean = newReminderDraft.trim()
    if (!userId || !clean || addingReminder) return
    setAddingReminder(true)
    setError('')
    try {
      const created = await createPercyReminder(userId, clean)
      setPercyReminders((current) => [...current, created])
      setNewReminderDraft('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to add that reminder.')
    } finally {
      setAddingReminder(false)
    }
  }

  async function removeReminder(reminderId: string) {
    if (!userId) return
    try {
      await deletePercyReminder(userId, reminderId)
      setPercyReminders((current) => current.filter((item) => item.id !== reminderId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to delete that reminder.')
    }
  }

  async function dismissReminder(reminderId: string) {
    if (!userId || dismissingReminderId) return
    setDismissingReminderId(reminderId)
    try {
      await dismissPercyReminder(userId, reminderId)
      setPercyReminders((current) => current.filter((item) => item.id !== reminderId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to dismiss that reminder.')
    } finally {
      setDismissingReminderId(null)
    }
  }

  /* -------------------------------------------------------------- scheduling */

  function openScheduleModal(item: Task | Goal, targetType: 'task' | 'goal' = 'task') {
    setScheduleTarget({ item, targetType, mode: 'reminder' })
  }

  function openSnoozeModal(item: Task | Goal, targetType: 'task' | 'goal' = 'task') {
    setScheduleTarget({ item, targetType, mode: 'snooze' })
  }

  async function saveScheduleModal(date: string, time: string, endTime: string) {
    if (!scheduleTarget) return
    setSavingSchedule(true)
    const remindAt = combineToRemindAt(date, time)
    const duration = scheduleTarget.mode === 'reminder' && endTime
      ? durationMinutesFromTimes(time || '09:00', endTime)
      : null
    const wantsCalendar = scheduleTarget.mode === 'reminder'
    try {
      let updated: Task | Goal | undefined
      const schedulePatch = {
        remind_at: remindAt,
        ...(duration != null ? { duration_minutes: duration } : {}),
      }
      if (scheduleTarget.targetType === 'task') {
        const task = scheduleTarget.item as Task
        updated = scheduleTarget.mode === 'reminder'
          ? await patchTask(task, schedulePatch)
          : await patchTask(task, { remind_at: remindAt, snoozed_until: date })
      } else {
        const goal = scheduleTarget.item as Goal
        updated = scheduleTarget.mode === 'reminder'
          ? await patchGoal(goal, schedulePatch)
          : await patchGoal(goal, { remind_at: remindAt, snoozed_until: date })
      }
      if (!updated) return
      if (wantsCalendar && updated.remind_at) {
        if (!googleStatus?.connected) {
          setNotice('Reminder saved — connect Google Calendar so it shows up with a notification.')
        } else if (!updated.has_calendar_reminder) {
          setError('Reminder saved, but it couldn’t be added to Google Calendar. Try reconnecting Google in Settings.')
        } else {
          setNotice('Added to your Google Calendar.')
        }
      }
      setScheduleTarget(null)
    } finally {
      setSavingSchedule(false)
    }
  }

  async function clearScheduleModal() {
    if (!scheduleTarget) return
    setSavingSchedule(true)
    try {
      if (scheduleTarget.targetType === 'task') {
        const task = scheduleTarget.item as Task
        await patchTask(task, scheduleTarget.mode === 'reminder'
          ? { remind_at: null }
          : { remind_at: null, snoozed_until: null })
      } else {
        const goal = scheduleTarget.item as Goal
        await patchGoal(goal, scheduleTarget.mode === 'reminder'
          ? { remind_at: null }
          : { remind_at: null, snoozed_until: null })
      }
      setScheduleTarget(null)
    } finally {
      setSavingSchedule(false)
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
      setGoogleStatus(await disconnectGoogle(userId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to disconnect Google Calendar.')
    } finally {
      setConnectingGoogle(false)
    }
  }

  async function addCalendarPrompt(promptText: string) {
    const clean = promptText.trim()
    if (!userId || !clean || addingCalendarBatch) return
    setAddingCalendarBatch(true)
    setError('')
    try {
      const res = await addToCalendarNaturalLanguage(userId, clean)
      const refreshedTasks = await getTasks(userId)
      setTasks(refreshedTasks)
      if (res.google_connected) {
        setNotice(res.summary_message || `Added ${res.created_tasks.length} reminders to Google Calendar.`)
      } else {
        setNotice(`${res.summary_message || `Added ${res.created_tasks.length} reminders.`} Connect Google Calendar in Settings or above to sync with Google.`)
      }
      refreshBackgroundState()
      return res
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to add items to calendar.')
      throw reason
    } finally {
      setAddingCalendarBatch(false)
    }
  }

  /* ---------------------------------------------------------------- weekly */

  async function beginStartWeeklyPlanning() {
    if (!userId || startingWeeklyPlanning) return
    setStartingWeeklyPlanning(true)
    setError('')
    try {
      setWeeklySession(await startWeeklyPlanning(userId, weekStart))
      const [reminders, taskList, goals, lastWeek] = await Promise.all([
        getPercyReminders(userId),
        getTasks(userId),
        getWeeklyGoals(userId, weekStart),
        getWeeklyGoals(userId, addDaysToIsoDate(weekStart, -7)),
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

  async function finishWeeklySession() {
    if (!userId || !weeklySession || finishingWeeklyPlanning) return
    setFinishingWeeklyPlanning(true)
    setError('')
    try {
      setWeeklySession(await finishWeeklyPlanning(userId, weekStart))
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
      setWeeklySession(await startWeeklyPlanning(userId, weekStart))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to re-open weekly planning.')
    } finally {
      setStartingWeeklyPlanning(false)
    }
  }

  async function handleGenerateWeeklyReflection() {
    if (!userId || generatingReflection) return
    setGeneratingReflection(true)
    setError('')
    try {
      setWeeklySession(await generateWeeklyReflection(userId, weekStart))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to generate weekly reflection.')
    } finally {
      setGeneratingReflection(false)
    }
  }

  /* ------------------------------------------------------------------- percy */

  function findContextQuestion(messageIndex: number): string | undefined {
    for (let i = messageIndex - 1; i >= 0; i -= 1) {
      if (chatMessages[i].role === 'user') return chatMessages[i].content
    }
    return undefined
  }

  function isAdviceSaved(adviceText: string): boolean {
    return savedPercyAdvice.some((item) => item.advice_text === adviceText)
  }

  async function sendPercyMessage(promptText?: string, insightOverride?: { id?: string; text: string }) {
    const textToSend = promptText ?? chatInput.trim()
    if (!userId || !textToSend || chatLoading) return

    const targetInsight = insightOverride ?? activeChatInsight
    const newHistory: PercyChatMessage[] = [...chatMessages, { role: 'user', content: textToSend }]

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
        activeChatThread?.question,
      )
      setChatMessages([...newHistory, { role: 'assistant', content: res.reply }])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to chat with Percy right now.')
    } finally {
      setChatLoading(false)
    }
  }

  async function savePercyAdvice(messageIndex: number) {
    if (!userId || savingAdviceIndex !== null) return
    const message = chatMessages[messageIndex]
    if (!message || message.role !== 'assistant' || isAdviceSaved(message.content)) return

    setSavingAdviceIndex(messageIndex)
    setError('')
    try {
      const saved = await createSavedPercyAdvice(userId, message.content, findContextQuestion(messageIndex))
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

  async function dismissInsight(insightId: string) {
    if (!userId) return
    try {
      await dismissLifeInsight(userId, insightId)
      setLifeInsights((current) => current.filter((insight) => insight.id !== insightId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to dismiss that insight.')
    }
  }

  function askPercyAboutInsight(insight: LifeInsight) {
    setActiveChatThread(null)
    setActiveChatInsight({ id: insight.id, text: insight.insight_text })
    setChatInput(`Can you tell me more about this insight and how you reached this conclusion: "${insight.insight_text}"?`)
    setPanel('percy')
    setTimeout(() => {
      percyChatRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      percyInputRef.current?.focus()
    }, 60)
  }

  async function handlePercyCreateGoal() {
    if (!userId || !percyGoalQuery.trim() || creatingPercyGoal) return
    setCreatingPercyGoal(true)
    setError('')
    setPercyGoalReply('')
    try {
      const res = await createGoalWithPercy(userId, percyGoalQuery.trim(), weekStart)
      setWeeklyGoals((current) => [...current, res.goal])
      setPercyGoalReply(res.reply)
      setPercyGoalQuery('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create goal with Percy right now.')
    } finally {
      setCreatingPercyGoal(false)
    }
  }

  /* ---------------------------------------------------------------- settings */

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

  async function refreshSpellingCorrections() {
    if (!userId) return
    try {
      setSpellingCorrections(await getSpellingCorrections(userId))
    } catch {
      // Quiet background refresh.
    }
  }

  async function addSpellingCorrection() {
    const incorrect = newIncorrectDraft.trim()
    const correct = newCorrectDraft.trim()
    if (!userId || !incorrect || !correct || addingCorrection) return
    setAddingCorrection(true)
    setError('')
    try {
      const created = await createSpellingCorrection(userId, incorrect, correct)
      setSpellingCorrections((current) => [
        created,
        ...current.filter((item) => item.incorrect_word.toLowerCase() !== incorrect.toLowerCase()),
      ])
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
      setSpellingCorrections((current) => current.filter((item) => item.id !== correctionId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to remove that spelling correction.')
    } finally {
      setDeletingCorrectionId(null)
    }
  }

  /* ------------------------------------------------------------------ import */

  function addImportRow() {
    setImportRows((current) => [...current, { id: makeRowId(), date: '', text: '' }])
  }

  function removeImportRow(id: string) {
    setImportRows((current) => (current.length > 1 ? current.filter((row) => row.id !== id) : current))
  }

  function updateImportRow(id: string, field: 'date' | 'text', value: string) {
    setImportRows((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)))
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
      if (reopened) {
        setPanel(null)
        openEntry(reopened)
      }
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

  function signOut() {
    if (userId) {
      localStorage.removeItem(`myjourn_cache_${userId}_entries`)
      localStorage.removeItem(`myjourn_cache_${userId}_tasks`)
      localStorage.removeItem(`myjourn_cache_${userId}_sections`)
      localStorage.removeItem(`myjourn_cache_${userId}_weekly_goals`)
      localStorage.removeItem(`myjourn_cache_${userId}_daily_plan`)
      localStorage.removeItem(`myjourn_cache_${userId}_north_star`)
    }
    lastLoadedUserIdRef.current = null
    setUserId('')
    setEntries([])
    setTasks([])
    setSections([])
    setDailyPlan(null)
    setWeeklyGoals([])
    setNorthStar('')
    supabase.auth.signOut()
  }

  return {
    // session
    sessionUser, authChecking, userId, loading, error, setError, notice, setNotice, signOut,

    // navigation
    activePage, setActivePage, goHome, panel, openPanel, closePanel, composerOpen, openComposer, closeComposer,
    activeEntry, openEntry, closeEntry, continueThread,

    // clock + day
    phase, todayIso, weekStart, dayState, planCompleted, dayPanelCollapsed, setDayPanelCollapsed,
    morningSelectedIds, toggleMorningTask, saveDayPlan, savingMorningPlan, planEditing, setPlanEditing,
    startEditingPlan, todayEntry, doneTodayCount,

    // data
    entries, filteredEntries, search, setSearch, tasks, visibleTasks, snoozedTasks, plannedTasks,
    backlogTasks, weeklyGoals, openGoals, lastWeekGoals, percyReminders, lifeInsights, unreadInsightCount,
    savedPercyAdvice, spellingCorrections, dailyPlan, weeklyWins, weeklyEntries,
    northStar, setNorthStar, savedNorthStar, googleStatus,

    // composer
    draft, setDraft, entryDate, setEntryDate, saveVerbatim, setSaveVerbatim, appendTarget,
    generating, submitEntry, listening, toggleVoice, editorRef,

    // entry reader
    editingNarrative, beginNarrativeEdit, cancelNarrativeEdit, narrativeDraft, setNarrativeDraft,
    savingNarrative, saveNarrativeEdit, editingDate, beginDateEdit, cancelDateEdit, dateDraft,
    setDateDraft, savingDate, saveDateEdit, deletingEntry, removeActiveEntry, entryListRef,

    // tasks
    newTaskDraft, setNewTaskDraft, newTaskStartTime, setNewTaskStartTime, newTaskEndTime,
    setNewTaskEndTime, newTaskSectionId, setNewTaskSectionId, addingTask, addManualTask,
    taskFormOpen, setTaskFormOpen, snoozedOpen, setSnoozedOpen, updatingTaskId, patchTask,
    acknowledgeHighlight, draggedTaskId, taskDropTarget, handleTaskDragStart, handleTaskDragOver,
    handleTaskDrop, clearTaskDrag,

    // task sections
    sections, sectionFormOpen, setSectionFormOpen, openSectionForm, editingSectionId,
    startEditingSection, cancelSectionEdit, newSectionName, setNewSectionName, newSectionColor,
    setNewSectionColor, addingSection, addSection, saveSectionEdit, removeSection,
    collapsedSectionIds, toggleSectionCollapsed, sectionDropTarget, handleSectionDragOver,
    handleSectionDrop, moveTaskToSection, draggedSectionId, sectionReorderTarget,
    handleSectionReorderDragStart, handleSectionReorderDrop, clearSectionReorderDrag,

    // goals
    newGoalDraft, setNewGoalDraft, newGoalTargetCount, setNewGoalTargetCount, addingGoal, addWeeklyGoal,
    goalFormOpen, setGoalFormOpen, updatingGoalId, updateGoalProgress, changeGoalStatus, editingGoalId,
    setEditingGoalId, editGoalText, setEditGoalText, editGoalTarget, setEditGoalTarget, startEditingGoal,
    saveGoalEdit, draggedGoalId, goalDropTarget, handleGoalDragStart, handleGoalDragOver, handleGoalDrop,
    clearGoalDrag,

    // reminders
    newReminderDraft, setNewReminderDraft, addingReminder, addReminder, removeReminder,
    dismissReminder, dismissingReminderId,

    // scheduling
    scheduleTarget, setScheduleTarget, savingSchedule, saveScheduleModal, clearScheduleModal,
    openScheduleModal, openSnoozeModal, connectGoogle, disconnectGoogleAccount, connectingGoogle,
    addingCalendarBatch, addCalendarPrompt,

    // weekly
    weeklySession, weeklySessionChecked, weeklyLoading, startingWeeklyPlanning, beginStartWeeklyPlanning,
    finishingWeeklyPlanning, finishWeeklySession, reopenWeeklySession, generatingReflection,
    handleGenerateWeeklyReflection,

    // percy
    chatMessages, chatInput, setChatInput, chatLoading, sendPercyMessage, savingAdviceIndex,
    savePercyAdvice, isAdviceSaved, deletingAdviceId, removeSavedAdvice, activeChatInsight,
    setActiveChatInsight, activeChatThread, setActiveChatThread, askPercyAboutInsight, dismissInsight,
    percyChatRef, percyInputRef, percyGoalQuery, setPercyGoalQuery, creatingPercyGoal,
    handlePercyCreateGoal, percyGoalReply, setPercyGoalReply,

    // settings & theme
    themeMode, setThemeMode, isNightTime, isDarkMode, toggleThemeMode,
    savingSettings, updateNorthStar, newIncorrectDraft, setNewIncorrectDraft, newCorrectDraft,
    setNewCorrectDraft, addingCorrection, addSpellingCorrection, deletingCorrectionId,
    removeSpellingCorrection,

    // import
    importRows, addImportRow, removeImportRow, updateImportRow, importBulkText, setImportBulkText,
    parseBulkImport, importing, importProgress, startImport,
  }
}

export type JournalState = ReturnType<typeof useJournalState>
