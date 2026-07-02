type Props = { children: React.ReactNode; className?: string }

// ponytail: wrapper used by screens that need the full glass shell independently (error states etc)
export function FullscreenCard({ children, className = '' }: Props) {
  return (
    <div className={`flex flex-col w-full h-full overflow-hidden ${className}`}>
      {children}
    </div>
  )
}
