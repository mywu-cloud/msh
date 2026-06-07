'use client'
import clsx from 'clsx'
import useSWR from 'swr'

type Market = 'twse' | 'tpex'

interface Props {
  active: Market
  onChange: (m: Market) => void
  industry: string
  onIndustryChange: (ind: string) => void
  market: Market
}

interface ApiRow {
  industry: string
  is_etf?: boolean
}

interface ApiResponse {
  data: ApiRow[]
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://msh-api.tw-mywu.workers.dev'
const fetcher = (url: string) => fetch(url).then(r => r.json())

const TABS: { value: Market; label: string; sub: string }[] = [
  { value: 'twse', label: '上市', sub: '台灣證交所' },
  { value: 'tpex', label: '上櫃', sub: '台灣櫃買中心' },
]

export function MarketTabs({ active, onChange, industry, onIndustryChange, market }: Props) {
  const { data } = useSWR<ApiResponse>(
    `${API_BASE}/api/big-holder-changes?market=${market}&limit=5000&sort=total_change&weeks=6`,
    fetcher,
    { revalidateOnFocus: false }
  )

  const rows: ApiRow[] = Array.isArray(data) ? data : (data?.data || [])
  const industries = Array.from(
    new Set(rows.filter(r => !r.is_etf).map(r => r.industry).filter(Boolean))
  ).sort() as string[]

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-0">
      <div className="flex gap-1">
        {TABS.map(t => (
          <button
            key={t.value}
            onClick={() => { onChange(t.value); onIndustryChange('') }}
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
      {industries.length > 0 && (
        <select
          value={industry}
          onChange={e => onIndustryChange(e.target.value)}
          className="text-xs border border-slate-200 rounded px-2 py-1.5 text-slate-600 bg-white hover:border-slate-300 focus:outline-none focus:border-primary-400 mb-1"
        >
          <option value="">全部產業</option>
          {industries.map(ind => (
            <option key={ind} value={ind}>{ind}</option>
          ))}
        </select>
      )}
    </div>
  )
}
