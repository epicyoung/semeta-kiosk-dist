import type { PointerEvent, ReactNode } from 'react'

function spawnBurst(x: number, y: number) {
  for (let i = 0; i < 12; i++) {
    const d = document.createElement('div')
    d.className = 'burst-dot'
    const angle = (Math.PI * 2 * i / 12) + (Math.random() - 0.5) * 0.8
    const dist = 28 + Math.random() * 36
    const l = Math.round(55 + Math.random() * 40)
    d.style.cssText = `left:${x - 3}px;top:${y - 3}px;background:hsl(0,0%,${l}%);--tx0:0px;--ty0:0px;--tx1:${(Math.cos(angle) * dist).toFixed(1)}px;--ty1:${(Math.sin(angle) * dist).toFixed(1)}px;`
    document.body.appendChild(d)
    d.addEventListener('animationend', () => d.remove(), { once: true })
  }
}

type Props = {
  children: ReactNode
  onClick?: () => void
  onPointerDown?: (e: PointerEvent<HTMLButtonElement>) => void
  variant?: 'primary' | 'secondary' | 'ghost'
  disabled?: boolean
  className?: string
}

export function TouchButton({ children, onClick, onPointerDown, variant = 'primary', disabled, className = '' }: Props) {
  const handlePointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    spawnBurst(e.clientX, e.clientY)
    onPointerDown?.(e)
  }

  const handleClick = () => {
    onClick?.()
  }

  return (
    <button
      onClick={disabled ? undefined : handleClick}
      onPointerDown={disabled ? undefined : handlePointerDown}
      disabled={disabled}
      className={['glass-btn h-[72px]', className].join(' ')}
      style={variant === 'primary' ? {
        background: 'rgba(255,255,255,0.18)',
        color: 'rgba(255,255,255,0.9)',
        boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.4), inset -1px -1px 0 rgba(0,0,0,0.2)',
      } : variant === 'secondary' ? {
        background: 'rgba(255,255,255,0.1)',
        color: '#ffffff',
        boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.2), inset -1px -1px 0 rgba(0,0,0,0.2)',
      } : {
        background: 'transparent',
        color: '#ffffff',
        boxShadow: 'none',
      }}
    >
      {children}
    </button>
  )
}
