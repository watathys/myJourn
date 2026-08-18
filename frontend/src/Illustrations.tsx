export function WorkingOnIllustration({ className = 'card-illustration' }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="forest-bg-work" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
            <stop stopColor="#305646" />
            <stop offset="1" stopColor="#234235" />
          </linearGradient>
        </defs>
        {/* Forest Green Background Box */}
        <rect width="48" height="48" rx="13" fill="url(#forest-bg-work)" />

        {/* Target Graphic - Large, bold, high-contrast */}
        <circle cx="24" cy="24" r="14" stroke="#FFFFFF" strokeWidth="2.5" strokeOpacity="0.95" fill="none" />
        <circle cx="24" cy="24" r="8.5" fill="#FBBF24" stroke="#FFFFFF" strokeWidth="1.5" />
        <circle cx="24" cy="24" r="4" fill="#EF4444" />

        {/* Dart flying into target */}
        <path d="M37 11L26.5 21.5" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M37 11L33 13.5L34.5 15L37 11Z" fill="#FBBF24" />
        <path d="M37 11L34.5 15L36 16.5L37 11Z" fill="#F59E0B" />
      </svg>
    </div>
  )
}

export function WeeklyGoalsIllustration({ className = 'card-illustration' }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="forest-bg-goals" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
            <stop stopColor="#305646" />
            <stop offset="1" stopColor="#234235" />
          </linearGradient>
        </defs>
        {/* Forest Green Background Box */}
        <rect width="48" height="48" rx="13" fill="url(#forest-bg-goals)" />

        {/* Large Sparkling Trophy Star */}
        <path
          d="M24 10L27.5 17.5L35 18.5L29.5 24L31 31.5L24 27.5L17 31.5L18.5 24L13 18.5L20.5 17.5L24 10Z"
          fill="#FBBF24"
          stroke="#FFFFFF"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {/* Center Checkmark Badge */}
        <circle cx="24" cy="22" r="5" fill="#305646" />
        <path
          d="M21.5 22L23.2 23.8L26.5 20.2"
          stroke="#FBBF24"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Sparkle details */}
        <path d="M37 10L38 7L39 10L42 11L39 12L38 15L37 12L34 11L37 10Z" fill="#FFFFFF" opacity="0.9" />
      </svg>
    </div>
  )
}

export function RemindersIllustration({ className = 'card-illustration' }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="forest-bg-reminders" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
            <stop stopColor="#305646" />
            <stop offset="1" stopColor="#234235" />
          </linearGradient>
        </defs>
        {/* Forest Green Background Box */}
        <rect width="48" height="48" rx="13" fill="url(#forest-bg-reminders)" />

        {/* Large Cheerful Golden Bell */}
        <path
          d="M24 11C19.5 11 17 14.5 17 20V26L14 30H34L31 26V20C31 14.5 28.5 11 24 11Z"
          fill="#FBBF24"
          stroke="#FFFFFF"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {/* Bell Loop at Top */}
        <path d="M21 11C21 9.3 22.3 8 24 8C25.7 8 27 9.3 27 11" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
        {/* Bell Clapper */}
        <path d="M21.5 32C21.5 33.7 22.6 35 24 35C25.4 35 26.5 33.7 26.5 32" fill="#F59E0B" stroke="#FFFFFF" strokeWidth="1.5" />
        {/* Sound Waves */}
        <path d="M36 19C37.8 21 38.5 23.5 38.5 26" stroke="#FBBF24" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M12 19C10.2 21 9.5 23.5 9.5 26" stroke="#FBBF24" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </div>
  )
}

export function ReviewLastWeekIllustration({ className = 'card-illustration' }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="forest-bg-review" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
            <stop stopColor="#305646" />
            <stop offset="1" stopColor="#234235" />
          </linearGradient>
        </defs>
        <rect width="48" height="48" rx="13" fill="url(#forest-bg-review)" />

        {/* Calendar Flip Card */}
        <rect x="11" y="13" width="26" height="24" rx="4" fill="#FFFFFF" />
        <path d="M11 21H37" stroke="#305646" strokeWidth="2.5" />
        <rect x="16" y="9" width="3.5" height="7" rx="1.75" fill="#FBBF24" stroke="#FFFFFF" strokeWidth="1" />
        <rect x="28.5" y="9" width="3.5" height="7" rx="1.75" fill="#FBBF24" stroke="#FFFFFF" strokeWidth="1" />
        {/* Rewind arrow */}
        <path d="M28 29C28 25.7 25.3 23 22 23C18.7 23 16 25.7 16 29C16 32.3 18.7 35 22 35" stroke="#305646" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M18 25.5L15.5 29.5L20 29.5" stroke="#305646" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

export function SevenDaysWinsIllustration({ className = 'card-illustration' }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="forest-bg-wins" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
            <stop stopColor="#305646" />
            <stop offset="1" stopColor="#234235" />
          </linearGradient>
        </defs>
        <rect width="48" height="48" rx="13" fill="url(#forest-bg-wins)" />

        {/* Checkmark Badge */}
        <circle cx="24" cy="24" r="14" fill="#FBBF24" />
        <circle cx="24" cy="24" r="11" fill="#305646" />
        <path d="M18.5 24L22 27.5L29.5 20" stroke="#FBBF24" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M37 10L38 7L39 10L42 11L39 12L38 15L37 12L34 11L37 10Z" fill="#FFFFFF" opacity="0.9" />
      </svg>
    </div>
  )
}

export function WeeklyReflectionIllustration({ className = 'card-illustration' }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="forest-bg-reflect" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
            <stop stopColor="#305646" />
            <stop offset="1" stopColor="#234235" />
          </linearGradient>
        </defs>
        <rect width="48" height="48" rx="13" fill="url(#forest-bg-reflect)" />

        {/* Open Book / Digest graphic */}
        <path
          d="M12 16C12 16 17 14.5 24 17.5C31 14.5 36 16 36 16V34C36 34 31 32.5 24 35.5C17 32.5 12 34 12 34V16Z"
          fill="#FFFFFF"
        />
        <path d="M24 17.5V35.5" stroke="#305646" strokeWidth="2" strokeLinecap="round" />
        {/* Golden Sparkle */}
        <path d="M24 8L25.5 12.5L30 14L25.5 15.5L24 20L22.5 15.5L18 14L22.5 12.5L24 8Z" fill="#FBBF24" />
      </svg>
    </div>
  )
}
