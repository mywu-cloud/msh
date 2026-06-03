import clsx from 'clsx'

interface Props {
  score: number
  width?: number
}

export function ScoreBar({ score, width = 64 }: Props) {
  const pct = Math.min(Math.max(score, 0), 100)
  const color =
    pct >= 70 ? 'bg-green-500' :
    pct >= 40 ? 'bg-yellow-400' :
    'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 rounded-full bg-slate-200" style={{ width }}>
        <div className={clsx('h-2 rounded-full', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-600">{pct.toFixed(0)}</span>
    </div>
  )
}
