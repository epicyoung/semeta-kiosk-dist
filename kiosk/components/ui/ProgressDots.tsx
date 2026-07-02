const TOTAL = 7

export function ProgressDots({ current }: { current: number }) {
  return (
    <div
      className="flex items-center gap-3 px-6 py-3"
      style={{}}
      aria-label={`Step ${current} of ${TOTAL}`}
    >
      <span style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.15em' }}>
        {current}/{TOTAL}
      </span>
      <div className="flex-1 flex gap-[3px] items-center">
        {Array.from({ length: TOTAL }, (_, i) => (
          <div
            key={i}
            className="flex-1 h-[2px] transition-all duration-500"
            style={{
              background: i + 1 === current
                ? 'rgba(255,255,255,0.8)'
                : i + 1 < current
                ? 'rgba(255,255,255,0.3)'
                : 'rgba(255,255,255,0.1)',
            }}
          />
        ))}
      </div>
    </div>
  )
}
