import clsx from 'clsx'

interface Props {
  value: number
  unit?: string
  decimals?: number
}

export function ChangeTag({ value, unit = '%', decimals = 2 }: Props) {
  const isPos = value > 0
  const isNeg = value < 0
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold',
        isPos && 'bg-green-100 text-green-700',
        isNeg && 'bg-red-100 text-red-700',
        !isPos && !isNeg && 'bg-slate-100 text-slate-500'
      )}
    >
      {isPos ? '+' : ''}{value.toFixed(decimals)}{unit}
    </span>
  )
}
