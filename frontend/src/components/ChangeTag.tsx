import clsx from 'clsx'

  interface Props {
    value: number
        unit?: string
        decimals?: number
      }

export function ChangeTag({ value, unit = '', decimals = 2 }: Props) {
  if (value === 0 || isNaN(value)) {
    return <span className="text-xs text-slate-400">—</span>
}

  const isUp = value > 0
  const display = `${isUp ? '+' : ''}${value.toFixed(decimals)}${unit}`

  return (
    <span className={clsx(isUp ? 'badge-up' : 'badge-down')}>
{isUp ? '▲' : '▼'} {display}
    </span>
  )
}
