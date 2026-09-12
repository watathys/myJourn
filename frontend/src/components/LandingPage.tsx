import {
  ArrowRight,
  BookOpen,
  CalendarRange,
  CircleCheck,
  Compass,
  Lightbulb,
  MessageCircle,
  PenLine,
  Sparkles,
  Sunrise,
  Target,
} from 'lucide-react'

type LandingPageProps = {
  onSignIn: () => void
  onGetStarted: () => void
}

const FEATURES = [
  {
    icon: PenLine,
    title: 'Write without friction',
    body: 'Type or speak — no structure, no formatting, no pressure. Just dump whatever is in your head.',
  },
  {
    icon: Sparkles,
    title: 'Percy reads it back',
    body: 'Your rough notes become a clean narrative and a kind reflection, with questions that take you deeper.',
  },
  {
    icon: Sunrise,
    title: 'A gentle daily rhythm',
    body: 'Plan your morning, focus your day, and reflect at night — one quiet ritual that keeps you honest.',
  },
  {
    icon: Target,
    title: 'Tasks & goals that stick',
    body: 'Turn reflections into intentions, and track what you actually finish — without the guilt.',
  },
  {
    icon: CalendarRange,
    title: 'A weekly reset',
    body: 'A planning and reflection session each week keeps the long view in focus, not just the day-to-day.',
  },
  {
    icon: Lightbulb,
    title: 'Insights over time',
    body: 'Percy notices patterns, wins, and threads across your entries that you would never spot yourself.',
  },
]

const WHY = [
  {
    icon: Compass,
    title: 'Clarity',
    body: 'See where your energy really goes. The gap between the days you want and the days you live becomes visible.',
  },
  {
    icon: Target,
    title: 'Alignment',
    body: 'Hold each day against what matters to you. A gentle north star keeps small decisions pointing the same way.',
  },
  {
    icon: BookOpen,
    title: 'Memory',
    body: 'Build a searchable story of your own life — the wins, the hard weeks, the ordinary Tuesdays.',
  },
  {
    icon: CircleCheck,
    title: 'Momentum',
    body: 'Turn reflection into action. Insights become goals, and goals get tracked as they actually happen.',
  },
]

const STEPS = [
  {
    num: '01',
    title: 'Write',
    body: 'Spend two minutes dumping whatever is on your mind. No editing, no structure.',
  },
  {
    num: '02',
    title: 'Reflect',
    body: 'Percy turns it into a smooth narrative and a reflection, in your own voice.',
  },
  {
    num: '03',
    title: 'Notice',
    body: 'Patterns, wins, and follow-up questions surface over time, so you can course-correct.',
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
            <a href="#features">Features</a>
            <a href="#how-it-works">How it works</a>
            <a href="#why">Why journal</a>
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
              <p className="landing-eyebrow"><Sparkles /> Your life, reflected back</p>
              <h1 className="landing-h1">Write your day. Understand your life.</h1>
              <p className="landing-hero-sub">
                Bookends is a private, AI-assisted journal that turns your daily notes into a
                clear narrative, surfaces the patterns you'd miss, and keeps you aligned with
                what actually matters.
              </p>
              <div className="landing-hero-ctas">
                <button type="button" className="landing-primary landing-primary-lg" onClick={onGetStarted}>
                  Start journaling free <ArrowRight />
                </button>
                <a href="#how-it-works" className="landing-secondary">
                  See how it works
                </a>
              </div>
            </div>

            <div className="landing-hero-preview" aria-hidden="true">
              <div className="landing-preview-note">
                <span className="landing-preview-label">You write</span>
                <p>“Work was a blur. Cooked dinner, called Mom, finally went for a run.”</p>
              </div>
              <div className="landing-preview-arrow">
                <ArrowRight />
              </div>
              <div className="landing-preview-narrative">
                <span className="landing-preview-label">Percy reflects</span>
                <p>A busy day with a quiet win: you kept a promise to yourself and ran.</p>
                <span className="landing-preview-chip"><Sparkles /> Pattern noticed: evening runs stick</span>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-section" id="features">
          <div className="landing-container">
            <div className="landing-section-head">
              <p className="landing-eyebrow">What's inside</p>
              <h2 className="landing-h2">Everything you need to audit your life, gently</h2>
              <p className="landing-lead">
                Bookends is built around one loop: write honestly, reflect kindly, notice clearly.
              </p>
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

        <section className="landing-section landing-section-alt" id="how-it-works">
          <div className="landing-container">
            <div className="landing-section-head">
              <p className="landing-eyebrow">How it works</p>
              <h2 className="landing-h2">Two minutes a day is enough</h2>
              <p className="landing-lead">
                No streaks to maintain, no blank page to fear. Just a small, honest habit.
              </p>
            </div>
            <ol className="landing-steps">
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

        <section className="landing-section" id="why">
          <div className="landing-container landing-why-grid">
            <div className="landing-section-head landing-why-copy">
              <p className="landing-eyebrow">Why journal</p>
              <h2 className="landing-h2">A life audit, one honest day at a time</h2>
              <p className="landing-lead">
                Bookends isn't a productivity tracker. It's a quiet place to write what actually
                happened — then see the patterns underneath.
              </p>
            </div>
            <div className="landing-why-list">
              {WHY.map(({ icon: Icon, title, body }) => (
                <div className="landing-why-item" key={title}>
                  <span className="landing-feature-icon"><Icon /></span>
                  <div>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-section landing-section-alt" id="percy">
          <div className="landing-container">
            <div className="landing-percy">
              <div className="landing-section-head">
                <p className="landing-eyebrow"><MessageCircle /> Meet Percy</p>
                <h2 className="landing-h2">Your journal, read back to you</h2>
                <p className="landing-lead">
                  Percy turns a raw brain-dump into a clean narrative and a kind reflection, then
                  remembers the threads across weeks so you don't have to. Ask anything, anytime.
                </p>
              </div>
              <div className="landing-percy-chat" aria-hidden="true">
                <div className="landing-chat-bubble landing-chat-user">
                  I keep putting off the same three things every week.
                </div>
                <div className="landing-chat-bubble landing-chat-percy">
                  That's been true for three weeks now. What tends to happen right before you
                  postpone them?
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-section" id="get-started">
          <div className="landing-container">
            <div className="landing-cta">
              <h2 className="landing-h2">Your story is already being written</h2>
              <p className="landing-lead">
                Start tonight. Two minutes is enough — the rest unfolds from there.
              </p>
              <div className="landing-hero-ctas">
                <button type="button" className="landing-primary landing-primary-lg" onClick={onGetStarted}>
                  Start journaling free <ArrowRight />
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
            <a href="#features">Features</a>
            <a href="#how-it-works">How it works</a>
            <a href="#why">Why journal</a>
          </nav>
          <p className="landing-footer-note">A private, AI-assisted journal. © 2026 Bookends.</p>
        </div>
      </footer>
    </div>
  )
}
