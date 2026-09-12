import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  CalendarRange,
  ListChecks,
  Lock,
  MessageCircle,
  PenLine,
  ScanSearch,
  Sparkles,
  Sunrise,
  Target,
} from 'lucide-react'

type LandingPageProps = {
  onSignIn: () => void
  onGetStarted: () => void
}

const STEPS = [
  {
    num: '01',
    title: 'Write it down',
    body: 'Two minutes, no structure. Type it or say it out loud. Your words are saved exactly as you wrote them unless you ask Percy to clean them up.',
  },
  {
    num: '02',
    title: 'Percy connects the days',
    body: 'Every entry gets read against the last two weeks, plus anything similar from further back. Percy is looking for the thing that keeps happening.',
  },
  {
    num: '03',
    title: 'You get one change to make',
    body: 'When the same thread shows up across three separate days, Percy names it out loud and suggests one practical thing to do differently.',
  },
  {
    num: '04',
    title: 'Weekly planning makes it real',
    body: 'Each week you read your week back, set goals with numbers on them, and clear the backlog — so the change has somewhere to land.',
  },
]

const INSIGHTS = [
  {
    pattern:
      'Three of your last four rough days started with a 6am alarm you snoozed twice. The good ones started later, on purpose.',
    change: 'Set the alarm for when you actually get up, and stop paying for the fight.',
  },
  {
    pattern:
      'You have written about calling your brother on five separate days this month. Every one of those days you also described as slammed.',
    change: 'Move it to a Sunday walk instead of a weekday gap that never opens.',
  },
  {
    pattern:
      'Every plan you dropped in the last three weeks was one you made for after 8pm. The morning ones you kept.',
    change: 'Put the thing that matters before work, not after it.',
  },
]

const WEEKLY = [
  {
    title: 'Read your week back',
    body: 'Percy writes up what actually happened — the wins, the parts that were hard — so you are not planning from memory.',
  },
  {
    title: 'See the patterns',
    body: 'The threads that ran through the week, pulled from your own entries rather than a template.',
  },
  {
    title: 'Pick one or two focuses',
    body: 'Percy suggests them from your week, not from a list of generic advice.',
  },
  {
    title: 'Set goals with a count',
    body: 'Run 3x. Cook 4 nights. A checkbox you tick, not a wish you forget.',
  },
  {
    title: 'Review last week honestly',
    body: 'What you said you would do, next to what you did. No spin.',
  },
  {
    title: 'Clear the backlog',
    body: 'Everything you have been carrying in one list, so nothing quietly rots.',
  },
]

const FEATURES = [
  {
    icon: PenLine,
    title: 'Write however it comes out',
    body: 'Type or talk. No prompts, no formatting, no streak to protect. Saved verbatim by default — ask for a polished narrative when you want one.',
  },
  {
    icon: ListChecks,
    title: 'Tasks pull themselves out',
    body: 'Mention that you still need to email your landlord and it lands in What I\u2019m Working On. Reorder it, snooze it, or schedule it.',
  },
  {
    icon: Sunrise,
    title: 'Bookend the day',
    body: 'Pick your handful of tasks in the morning, write your reflection at night. That is the entire ritual.',
  },
  {
    icon: Target,
    title: 'A north star, if you want one',
    body: 'Name what you are aiming at and every entry gets held against it — gently, not as a scoreboard.',
  },
  {
    icon: CalendarClock,
    title: 'Reminders that leave the app',
    body: 'Say “Percy, remind me Thursday at 9” and it lands on your Google Calendar with the rest of your life.',
  },
  {
    icon: Lock,
    title: 'Yours only',
    body: 'Your entries are private to your account. Percy reads them to help you — nothing is public, nothing is shared.',
  },
]

export function LandingPage({ onSignIn, onGetStarted }: LandingPageProps) {
  return (
    <div className="landing" id="top">
      <header className="landing-header">
        <div className="landing-container landing-header-inner">
          <a href="#top" className="landing-brand" aria-label="Bookends home">
            <span className="landing-brand-mark"><BookOpen /></span>
            <span className="landing-brand-name">Bookends</span>
          </a>

          <nav className="landing-nav" aria-label="Primary">
            <a href="#how-it-works">How it works</a>
            <a href="#insights">Insights</a>
            <a href="#weekly">Weekly planning</a>
          </nav>

          <div className="landing-header-actions">
            <button type="button" className="landing-link-button" onClick={onSignIn}>
              Sign in
            </button>
            <button type="button" className="landing-primary" onClick={onGetStarted}>
              Get started
            </button>
          </div>
        </div>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-container landing-hero-grid">
            <div className="landing-hero-copy">
              <p className="landing-eyebrow"><ScanSearch /> Journaling that talks back</p>
              <h1 className="landing-h1">Write your day. Find out what to change.</h1>
              <p className="landing-hero-sub">
                Bookends is a journal that does something with what you write. Percy reads your
                entries, connects them across weeks, and names the pattern quietly running your
                life — then tells you the one thing to do differently. Weekly planning turns it
                into a plan you actually finish.
              </p>
              <div className="landing-hero-ctas">
                <button type="button" className="landing-primary landing-primary-lg" onClick={onGetStarted}>
                  Start journaling <ArrowRight />
                </button>
                <a href="#how-it-works" className="landing-secondary">
                  See how it works
                </a>
              </div>
            </div>

            <div className="landing-hero-preview" aria-hidden="true">
              <span className="landing-preview-label">Three ordinary entries</span>
              <div className="landing-preview-days">
                <p className="landing-preview-day"><span>Mon</span> Work ran long, skipped the gym again.</p>
                <p className="landing-preview-day"><span>Wed</span> Too fried to cook, ordered in.</p>
                <p className="landing-preview-day"><span>Fri</span> Another late one at the desk.</p>
              </div>

              <div className="landing-preview-arrow">
                <ArrowRight />
              </div>

              <div className="landing-preview-insight">
                <span className="landing-preview-label"><Sparkles /> Percy noticed</span>
                <p className="landing-insight-pattern">
                  Three times in two weeks, a late night at work has wiped out whatever you had
                  planned for yourself that evening.
                </p>
                <p className="landing-insight-change">
                  <strong>Try this:</strong> move the thing you care about to the morning, before
                  work gets a vote.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-section" id="how-it-works">
          <div className="landing-container">
            <div className="landing-section-head">
              <p className="landing-eyebrow">How it works</p>
              <h2 className="landing-h2">Two minutes in. A specific change out.</h2>
              <p className="landing-lead">
                You do the easy part. Percy does the part no one can do for themselves — reading
                weeks of their own life at once and seeing the shape of it.
              </p>
            </div>
            <ol className="landing-steps landing-steps-4">
              {STEPS.map(({ num, title, body }) => (
                <li className="landing-step" key={num}>
                  <span className="landing-step-num" aria-hidden="true">{num}</span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="landing-section landing-section-alt" id="insights">
          <div className="landing-container">
            <div className="landing-section-head">
              <p className="landing-eyebrow">Life insights</p>
              <h2 className="landing-h2">It isn't about the writing. It's what the writing reveals.</h2>
              <p className="landing-lead">
                You already know what happened yesterday. What you can't see is the shape of the
                last three weeks — the same excuse in three different outfits, the gap between
                what you say you want and how the evenings actually go.
              </p>
            </div>

            <div className="landing-insights">
              {INSIGHTS.map(({ pattern, change }) => (
                <article className="landing-insight" key={pattern}>
                  <span className="landing-feature-icon"><Sparkles /></span>
                  <p className="landing-insight-pattern">{pattern}</p>
                  <p className="landing-insight-change">
                    <strong>Try this:</strong> {change}
                  </p>
                </article>
              ))}
            </div>

            <p className="landing-note">
              <ScanSearch />
              <span>
                Percy holds a high bar. The same thread has to show up across at least three
                separate days, and it has to tell you something you haven't already told yourself.
                Most days there is nothing worth saying — so Percy says nothing. This is an audit,
                not a daily horoscope.
              </span>
            </p>
          </div>
        </section>

        <section className="landing-section" id="weekly">
          <div className="landing-container landing-why-grid">
            <div className="landing-section-head landing-why-copy">
              <p className="landing-eyebrow"><CalendarRange /> Weekly planning</p>
              <h2 className="landing-h2">The half hour that makes the week work</h2>
              <p className="landing-lead">
                Insight is cheap until it hits a calendar. Once a week you sit down with your own
                week written up in front of you, decide what the next one is for, and walk out with
                a short list you can actually finish. Anything you asked Percy to bring up during
                the week is waiting here too.
              </p>
              <div className="landing-hero-ctas landing-weekly-cta">
                <button type="button" className="landing-primary" onClick={onGetStarted}>
                  Plan your first week <ArrowRight />
                </button>
              </div>
            </div>

            <ol className="landing-weekly-list">
              {WEEKLY.map(({ title, body }) => (
                <li className="landing-weekly-item" key={title}>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="landing-section landing-section-alt" id="features">
          <div className="landing-container">
            <div className="landing-section-head">
              <p className="landing-eyebrow">What's inside</p>
              <h2 className="landing-h2">Everything else stays out of your way</h2>
            </div>
            <div className="landing-grid">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <article className="landing-feature" key={title}>
                  <span className="landing-feature-icon"><Icon /></span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-section" id="percy">
          <div className="landing-container">
            <div className="landing-percy">
              <div className="landing-section-head">
                <p className="landing-eyebrow"><MessageCircle /> Meet Percy</p>
                <h2 className="landing-h2">Or just ask directly</h2>
                <p className="landing-lead">
                  Percy has read everything you have written. Ask why last month felt so heavy,
                  whether you are actually making progress on the thing you keep mentioning, or
                  what to do about the decision you keep circling. Keep the answers that land.
                </p>
              </div>
              <div className="landing-percy-chat" aria-hidden="true">
                <div className="landing-chat-bubble landing-chat-user">
                  Why do I keep bailing on my own plans?
                </div>
                <div className="landing-chat-bubble landing-chat-percy">
                  Every plan you dropped this month was one you made for after 8pm. The morning
                  ones you kept, all of them. What if the plan is fine and the hour isn't?
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-section" id="get-started">
          <div className="landing-container">
            <div className="landing-cta">
              <h2 className="landing-h2">You already know something needs to change</h2>
              <p className="landing-lead">
                Write tonight. Give it a week, and Percy will tell you what it is.
              </p>
              <div className="landing-hero-ctas">
                <button type="button" className="landing-primary landing-primary-lg" onClick={onGetStarted}>
                  Start journaling <ArrowRight />
                </button>
                <button type="button" className="landing-secondary" onClick={onSignIn}>
                  Sign in
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-container landing-footer-inner">
          <a href="#top" className="landing-brand" aria-label="Bookends home">
            <span className="landing-brand-mark"><BookOpen /></span>
            <span className="landing-brand-name">Bookends</span>
          </a>
          <nav className="landing-nav" aria-label="Footer">
            <a href="#how-it-works">How it works</a>
            <a href="#insights">Insights</a>
            <a href="#weekly">Weekly planning</a>
          </nav>
          <p className="landing-footer-note">A private journal that tells you what to change. © 2026 Bookends.</p>
        </div>
      </footer>
    </div>
  )
}
