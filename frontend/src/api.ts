import { supabase } from './supabase'

export type Task = {
  id: string
  goal_text: string
  status: 'pending' | 'completed' | 'abandoned'
  sort_order: number
  target_count?: number
  current_count?: number
  remind_at: string | null
  snoozed_until: string | null
  is_snoozed: boolean
  just_resurfaced: boolean
  has_calendar_reminder: boolean
}

export type Goal = {
  id: string
  goal_text: string
  status: 'pending' | 'completed' | 'abandoned'
  sort_order?: number
  target_count?: number
  current_count?: number
  week_start_date: string | null
  remind_at?: string | null
  snoozed_until?: string | null
  is_snoozed?: boolean
  just_resurfaced?: boolean
  has_calendar_reminder?: boolean
}

export type JournalEntry = {
  id: string
  date: string
  raw_transcript: string
  formatted_narrative: string
  alignment_summary: string
  created_at?: string
  goals: Task[]
  praise_message?: string | null
  completed_goals?: Task[]
  follow_up_questions?: string[]
}

export type PercyReminder = {
  id: string
  reminder_text: string
  is_dismissed: boolean
  created_at: string
}

export type LifeInsight = {
  id: string
  insight_text: string
  is_read: boolean
  is_dismissed: boolean
  created_at: string
}

export type SavedPercyAdvice = {
  id: string
  advice_text: string
  context_question: string | null
  created_at: string
}

export type SpellingCorrection = {
  id: string
  incorrect_word: string
  correct_word: string
  correction_count: number
  created_at: string
  updated_at: string
}

export type WeeklyReflection = {
  summary_narrative: string
  what_went_well: string[]
  what_was_hard: string[]
  patterns_worth_noticing: string[]
  suggested_focuses: string[]
}

export type WeeklyPlanningSession = {
  week_start_date: string
  started_at: string
  completed_at?: string | null
  reflection_data?: WeeklyReflection | null
  reflection_start_date?: string | null
  reflection_end_date?: string | null
  reflection_generated_at?: string | null
}

export type DailyPlan = {
  id: string
  date: string
  selected_task_ids: string[]
  morning_completed_at: string | null
  created_at: string
}

export type GoogleStatus = {
  connected: boolean
  email: string | null
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string>),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  let apiBase = (import.meta.env.VITE_API_URL || '/api').trim().replace(/\/$/, '')
  if (apiBase.includes('your-actual-backend-url') || apiBase.includes('example.com')) {
    apiBase = '/api'
  } else if (apiBase && !apiBase.startsWith('http://') && !apiBase.startsWith('https://') && !apiBase.startsWith('/')) {
    apiBase = `https://${apiBase}`
  }

  if (!apiBase.endsWith('/api')) {
    apiBase = `${apiBase}/api`
  }

  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => null)
    const fallbackMsg = `API request to ${path} failed with status ${response.status}${response.statusText ? ` (${response.statusText})` : ''}. Please ensure your backend is running.`
    const err = new Error(error?.detail || fallbackMsg)
    ;(err as Error & { status?: number }).status = response.status
    throw err
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export async function getAuthenticatedUser(): Promise<{ id: string; email?: string } | null> {
  const { data } = await supabase.auth.getSession()
  if (!data.session?.user) return null
  return {
    id: data.session.user.id,
    email: data.session.user.email,
  }
}

export function getEntries(userId: string): Promise<JournalEntry[]> {
  return request(`/users/${userId}/journal-entries`)
}

export async function processEntry(
  userId: string,
  date: string,
  rawTranscript: string,
  isImport = false,
  appendToEntryId?: string,
  verbatim = true,
): Promise<JournalEntry> {
  const result = await request<
    Omit<JournalEntry, 'id' | 'goals'> & {
      journal_entry_id: string
      new_goals: Task[]
      new_weekly_goals: Goal[]
      percy_reminders: string[]
      life_insights: string[]
    }
  >('/journal-entries/process', {
    method: 'POST',
    body: JSON.stringify({
      user_id: userId,
      date,
      raw_transcript: rawTranscript,
      is_import: isImport,
      verbatim,
      append_to_entry_id: appendToEntryId,
    }),
  })

  return {
    ...result,
    id: result.journal_entry_id,
    goals: result.new_goals,
  }
}

export function deleteJournalEntry(userId: string, entryId: string): Promise<void> {
  return request(`/journal-entries/${entryId}`, {
    method: 'DELETE',
    body: JSON.stringify({ user_id: userId }),
  })
}

export function updateJournalEntry(
  userId: string,
  entryId: string,
  updates: { formatted_narrative?: string; date?: string },
): Promise<JournalEntry> {
  return request(`/journal-entries/${entryId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      user_id: userId,
      ...updates,
    }),
  })
}

export async function getNorthStar(userId: string): Promise<string> {
  const result = await request<{ statement_text: string | null }>(
    `/users/${userId}/mission-statement`,
  )
  return result.statement_text ?? ''
}

export function saveNorthStar(userId: string, statement: string): Promise<unknown> {
  return request(`/users/${userId}/mission-statement`, {
    method: 'PUT',
    body: JSON.stringify({ statement_text: statement || null }),
  })
}

// ---------------------------------------------------------------------------
// Tasks ("What I'm Working On")
// ---------------------------------------------------------------------------

export function getTasks(userId: string): Promise<Task[]> {
  return request(`/users/${userId}/tasks`)
}

export function createTask(userId: string, goalText: string): Promise<Task> {
  return request(`/users/${userId}/tasks`, {
    method: 'POST',
    body: JSON.stringify({ goal_text: goalText }),
  })
}

export type TaskUpdate = {
  status?: Task['status']
  target_count?: number
  current_count?: number
  remind_at?: string | null
  snoozed_until?: string | null
}

export function updateTask(userId: string, taskId: string, updates: TaskUpdate): Promise<Task> {
  return request(`/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ user_id: userId, ...updates }),
  })
}

export function acknowledgeTaskSnooze(userId: string, taskId: string): Promise<Task> {
  return request(`/tasks/${taskId}/acknowledge-snooze`, {
    method: 'PATCH',
    body: JSON.stringify({ user_id: userId }),
  })
}

export function reorderTasks(userId: string, orderedIds: string[]): Promise<Task[]> {
  return request(`/users/${userId}/tasks/reorder`, {
    method: 'PATCH',
    body: JSON.stringify({ user_id: userId, ordered_ids: orderedIds }),
  })
}

// ---------------------------------------------------------------------------
// Daily plans (morning bookend)
// ---------------------------------------------------------------------------

export async function getDailyPlan(userId: string, planDate: string): Promise<DailyPlan | null> {
  try {
    return await request(`/users/${userId}/daily-plans/${planDate}`)
  } catch (error) {
    if ((error as Error & { status?: number }).status === 404) return null
    throw error
  }
}

export function saveDailyPlan(
  userId: string,
  planDate: string,
  selectedTaskIds: string[],
  completeMorning = true,
): Promise<DailyPlan> {
  return request(`/users/${userId}/daily-plans/${planDate}`, {
    method: 'PUT',
    body: JSON.stringify({
      user_id: userId,
      selected_task_ids: selectedTaskIds,
      complete_morning: completeMorning,
    }),
  })
}

// ---------------------------------------------------------------------------
// Weekly-planning goals
// ---------------------------------------------------------------------------

export function getWeeklyGoals(userId: string, weekStartDate: string): Promise<Goal[]> {
  return request(`/users/${userId}/goals?week_start_date=${weekStartDate}`)
}

export function createWeeklyGoal(
  userId: string,
  goalText: string,
  weekStartDate: string,
  targetCount?: number,
): Promise<Goal> {
  return request(`/users/${userId}/goals`, {
    method: 'POST',
    body: JSON.stringify({
      goal_text: goalText,
      week_start_date: weekStartDate,
      target_count: targetCount,
    }),
  })
}

export type GoalUpdate = {
  status?: Goal['status']
  goal_text?: string
  target_count?: number
  current_count?: number
  remind_at?: string | null
  snoozed_until?: string | null
}

export function updateGoal(
  userId: string,
  goalId: string,
  updates: GoalUpdate | Goal['status'],
): Promise<Goal> {
  const body = typeof updates === 'string' ? { status: updates } : updates
  return request(`/goals/${goalId}`, {
    method: 'PATCH',
    body: JSON.stringify({ user_id: userId, ...body }),
  })
}

export function reorderGoals(
  userId: string,
  weekStartDate: string,
  orderedIds: string[],
): Promise<Goal[]> {
  return request(`/users/${userId}/goals/reorder`, {
    method: 'PATCH',
    body: JSON.stringify({
      user_id: userId,
      week_start_date: weekStartDate,
      ordered_ids: orderedIds,
    }),
  })
}

export function createGoalWithPercy(
  userId: string,
  userQuery: string,
  weekStartDate: string,
): Promise<{ goal: Goal; reply: string }> {
  return request(`/users/${userId}/percy/create-goal`, {
    method: 'POST',
    body: JSON.stringify({
      user_query: userQuery,
      week_start_date: weekStartDate,
    }),
  })
}

// ---------------------------------------------------------------------------
// Weekly planning sessions (the "Start" gate)
// ---------------------------------------------------------------------------

export async function getWeeklyPlanningSession(
  userId: string,
  weekStartDate: string,
): Promise<WeeklyPlanningSession | null> {
  try {
    return await request(`/users/${userId}/weekly-planning/sessions/${weekStartDate}`)
  } catch (error) {
    if ((error as Error & { status?: number }).status === 404) return null
    throw error
  }
}

export function startWeeklyPlanning(
  userId: string,
  weekStartDate: string,
): Promise<WeeklyPlanningSession> {
  return request(`/users/${userId}/weekly-planning/sessions`, {
    method: 'POST',
    body: JSON.stringify({ week_start_date: weekStartDate }),
  })
}

export function finishWeeklyPlanning(
  userId: string,
  weekStartDate: string,
): Promise<WeeklyPlanningSession> {
  return request(`/users/${userId}/weekly-planning/sessions/${weekStartDate}/finish`, {
    method: 'POST',
  })
}

export function generateWeeklyReflection(
  userId: string,
  weekStartDate: string,
): Promise<WeeklyPlanningSession> {
  return request(`/users/${userId}/weekly-planning/sessions/${weekStartDate}/reflection`, {
    method: 'POST',
  })
}

// ---------------------------------------------------------------------------
// Google Calendar connection
// ---------------------------------------------------------------------------

export function getGoogleStatus(userId: string): Promise<GoogleStatus> {
  return request(`/users/${userId}/google/status`)
}

export async function getGoogleAuthorizeUrl(userId: string): Promise<string> {
  const result = await request<{ authorization_url: string }>(
    `/auth/google/authorize?user_id=${userId}`,
  )
  return result.authorization_url
}

export function disconnectGoogle(userId: string): Promise<GoogleStatus> {
  return request(`/users/${userId}/google/disconnect`, { method: 'POST' })
}

// ---------------------------------------------------------------------------
// Percy reminders + life insights
// ---------------------------------------------------------------------------

export function getPercyReminders(userId: string): Promise<PercyReminder[]> {
  return request(`/users/${userId}/percy-reminders`)
}

export function createPercyReminder(userId: string, reminderText: string): Promise<PercyReminder> {
  return request(`/users/${userId}/percy-reminders`, {
    method: 'POST',
    body: JSON.stringify({ reminder_text: reminderText }),
  })
}

export function dismissPercyReminder(userId: string, reminderId: string): Promise<PercyReminder> {
  return request(`/percy-reminders/${reminderId}/dismiss`, {
    method: 'PATCH',
    body: JSON.stringify({ user_id: userId }),
  })
}

export function deletePercyReminder(userId: string, reminderId: string): Promise<void> {
  return request(`/percy-reminders/${reminderId}`, {
    method: 'DELETE',
    body: JSON.stringify({ user_id: userId }),
  })
}

export function getLifeInsights(userId: string): Promise<LifeInsight[]> {
  return request(`/users/${userId}/life-insights`)
}

export function markLifeInsightRead(userId: string, insightId: string): Promise<LifeInsight> {
  return request(`/life-insights/${insightId}/read`, {
    method: 'PATCH',
    body: JSON.stringify({ user_id: userId }),
  })
}

export function dismissLifeInsight(userId: string, insightId: string): Promise<LifeInsight> {
  return request(`/life-insights/${insightId}/dismiss`, {
    method: 'PATCH',
    body: JSON.stringify({ user_id: userId }),
  })
}

export function getSavedPercyAdvice(userId: string): Promise<SavedPercyAdvice[]> {
  return request(`/users/${userId}/saved-percy-advice`)
}

export function createSavedPercyAdvice(
  userId: string,
  adviceText: string,
  contextQuestion?: string,
): Promise<SavedPercyAdvice> {
  return request(`/users/${userId}/saved-percy-advice`, {
    method: 'POST',
    body: JSON.stringify({
      advice_text: adviceText,
      context_question: contextQuestion ?? null,
    }),
  })
}

export function deleteSavedPercyAdvice(userId: string, adviceId: string): Promise<void> {
  return request(`/saved-percy-advice/${adviceId}`, {
    method: 'DELETE',
    body: JSON.stringify({ user_id: userId }),
  })
}

export type PercyChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

export function chatWithPercy(
  userId: string,
  message: string,
  history: PercyChatMessage[],
  insightId?: string,
  insightText?: string,
): Promise<{ reply: string }> {
  return request(`/users/${userId}/percy/chat`, {
    method: 'POST',
    body: JSON.stringify({
      message,
      history,
      insight_id: insightId,
      insight_text: insightText,
    }),
  })
}

// ---------------------------------------------------------------------------
// Spelling corrections
// ---------------------------------------------------------------------------

export function getSpellingCorrections(userId: string): Promise<SpellingCorrection[]> {
  return request(`/users/${userId}/spelling-corrections`)
}

export function createSpellingCorrection(
  userId: string,
  incorrectWord: string,
  correctWord: string,
): Promise<SpellingCorrection> {
  return request(`/users/${userId}/spelling-corrections`, {
    method: 'POST',
    body: JSON.stringify({
      incorrect_word: incorrectWord,
      correct_word: correctWord,
    }),
  })
}

export function deleteSpellingCorrection(
  userId: string,
  correctionId: string,
): Promise<void> {
  return request(`/spelling-corrections/${correctionId}`, {
    method: 'DELETE',
    body: JSON.stringify({ user_id: userId }),
  })
}
