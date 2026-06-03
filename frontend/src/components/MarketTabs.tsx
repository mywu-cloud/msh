'use client'
import clsx from 'clsx'

type Market = 'all' | 'twse' | 'tpex'

interface Props {
  active: Market
  onChange: (m: Market) => void
}

const TABS: { value: Market; label: string; sub: string }[] = [
  { value: 'all', label: '全部', sub: '上市 + 上櫃' },
  { value: 'twse', label: '上市', sub: '台灣證交所' },
  { value: 'tpex', label: '上櫃', sub: '台灣櫃買中心' },
]

export function MarketTabs({ active, onChange }: Props) {
  return (
    <div className="flex gap-1 pb-0">
      {TABS.map(t => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            'px-4 py-2 rounded-t-lg text-sm font-medium transition-colors',
            active === t.value
              ? 'bg-white text-primary-600 border-b-2 border-primary-500'
              : 'text-slate-500 hover:text-slate-700'
          )}
        >
          {t.label}
          <span className="ml-1 text-xs text-slate-400">{t.sub}</span>
        </button>
      ))}
    </div>
  )
}
