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
                'px-4 py-2.5 text-sm font-medium border-b-2 transition-all',
                active === t.value
                  ? 'border-primary-700 text-primary-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              )}
            >
              <span>{t.label}</span>
              <span className={clsx(
                'ml-1.5 text-xs hidden sm:inline',
                active === t.value ? 'text-primary-500' : 'text-slate-400'
              )}>
    {t.sub}
              </span>
            </button>
          ))}
    </div>
      )
    }
