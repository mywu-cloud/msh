'use client'

import { useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { TrendingUp, TrendingDown, AlertTriangle, ChevronRight } from 'lucide-react'
import { ChangeTag } from '@/components/ChangeTag'
import { MarketTabs } from '@/components/MarketTabs'
import { SearchBar } from '@/components/SearchBar'
import clsx from 'clsx'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://msh-api.workers.dev'
const fetcher = (url: string) => fetch(url).then(r => r.json())

type ChangeType = 'increase' | 'decrease'
type Market = 'all' | 'twse' | 'tpex'

interface StockChange {
  stock_code: string
  stock_name?: string
  market?: string
  big_holder_trend: number
  latest_week_change?: number
  score?: number
}

export default function TopChangesPage() {
  const [market, setMarket] = useState<Market>('all')
  const [type, setType] = useState<ChangeType>('increase')
  const [search, setSearch] = useState('')

  const { data, error, isLoading } = useSWR<StockChange[]>(
    `${API_BASE}/api/top-changes?market=${market}&type=${type}`,
    fetcher,
    { refreshInterval: 60000 }
  )

  const filtered = (data || []).filter(s =>
    s.stock_code.includes(search) ||
    (s.stock_name || '').includes(search)
  )

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">主力異動排行</h1>
          <p className="text-sm text-slate-500 mt-0.5">大股東持股比例顯著變化</p>
        </div>
        <SearchBar value={search} onChange={setSearch} placeholder="搜尋股票..." />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 pt-3 border-b border-slate-100">
          <MarketTabs active={market} onChange={setMarket} />
        </div>

        <div className="flex gap-2 px-4 py-3 border-b border-slate-100">
          {(['increase', 'decrease'] as ChangeType[]).map(t => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                type === t
                  ? t === 'increase'
                    ? 'bg-red-50 text-red-600'
                    : 'bg-green-50 text-green-600'
                  : 'text-slate-500 hover:bg-slate-50'
              )}
            >
              {t === 'increase'
                ? <><TrendingUp className="w-4 h-4" />主力買進</>
                : <><TrendingDown className="w-4 h-4" />主力賣出</>
              }
            </button>
          ))}
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
            <span className="animate-spin mr-2">⟳</span>載入中...
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center py-16 text-slate-400 text-sm gap-2">
            <AlertTriangle className="w-4 h-4" />
            無法載入資料，請稍後再試
          </div>
        )}

        {!isLoading && !error && filtered.length === 0 && (
          <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
            暫無資料
          </div>
        )}

        {!isLoading && !error && filtered.length > 0 && (
          <div className="divide-y divide-slate-100">
            {filtered.map((s, i) => (
              <Link
                key={s.stock_code}
                href={`/stock/${s.stock_code}`}
                className="flex items-center px-4 py-3 hover:bg-slate-50 transition-colors group"
              >
                <span className="w-7 text-xs text-slate-400 font-medium">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-800">{s.stock_code}</span>
                    <span className="text-sm text-slate-500 truncate">{s.stock_name}</span>
                    {s.market && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                        {s.market === 'twse' ? '上市' : '上櫃'}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <ChangeTag value={s.big_holder_trend} />
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
