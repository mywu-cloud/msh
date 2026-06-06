'use client'

import useSWR from 'swr'
import Link from 'next/link'
import { BarChart2, TrendingUp, TrendingDown } from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://msh-api.tw-mywu.workers.dev'
const fetcher = (url: string) => fetch(url).then(r => r.json())

interface BigHolderRow {
  stock_code: string
  stock_name: string
  market: string
  industry: string
  week_changes: Record<string, number>
  total_change: number
  latest_change: number
  latest_ratio: number
  week_dates: string[]
}

interface ApiResponse {
  meta: {
    market: string
    week_dates: string[]
    count: number
  }
  data: BigHolderRow[]
}

interface Props {
  market: 'all' | 'twse' | 'tpex'
  searchQuery: string
}

function formatDate(d: string): string {
  // Convert YYYYMMDD to MM/DD
  if (d.length === 8) return d.slice(4, 6) + '/' + d.slice(6, 8)
  if (d.length === 10) return d.slice(5, 7) + '/' + d.slice(8, 10)
  return d
}

function ChangeCell({ value }: { value: number }) {
  if (value === 0) return <td className="text-center text-slate-400 px-2 py-2 text-xs">—</td>
  const isPos = value > 0
  return (
    <td className={`text-center px-2 py-2 text-xs font-medium ${isPos ? 'text-red-600' : 'text-green-600'}`}>
      {isPos ? '+' : ''}{value.toFixed(2)}
    </td>
  )
}

function MarketBadge({ market }: { market: string }) {
  if (market === 'twse') return <span className="text-xs px-1 py-0.5 rounded bg-blue-50 text-blue-600">上市</span>
  if (market === 'tpex') return <span className="text-xs px-1 py-0.5 rounded bg-green-50 text-green-600">上櫃</span>
  return null
}

export function SkillDashboard({ market, searchQuery }: Props) {
  const { data, error, isLoading } = useSWR<ApiResponse>(
    `${API_BASE}/api/big-holder-changes?market=${market}&limit=100&sort=total_change&weeks=6`,
    fetcher,
    { refreshInterval: 3600000 }
  )

  if (isLoading) return (
    <div className="p-8 text-center text-slate-400">
      <div className="animate-spin w-8 h-8 border-2 border-primary-300 border-t-primary-600 rounded-full mx-auto mb-4" />
      <p>載入大股東籌碼資料中...</p>
    </div>
  )

  if (error || !data) return (
    <div className="p-8 text-center text-slate-400">
      <BarChart2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p className="font-medium">暫無資料</p>
      <p className="text-sm mt-1">請確認 API 服務正常，或等待週六資料更新</p>
    </div>
  )

  const rows: BigHolderRow[] = Array.isArray(data) ? data : (data.data || [])
  const weekDates: string[] = data.meta?.week_dates || (rows[0]?.week_dates || [])

  const filtered = rows.filter(r =>
    !searchQuery ||
    r.stock_code.includes(searchQuery) ||
    (r.stock_name || '').includes(searchQuery) ||
    (r.industry || '').includes(searchQuery)
  )

  if (filtered.length === 0) return (
    <div className="p-8 text-center text-slate-400"><p>找不到符合條件的股票</p></div>
  )

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="text-left px-3 py-2 text-slate-500 font-medium w-8">#</th>
            <th className="text-left px-3 py-2 text-slate-500 font-medium">股票代號/名稱</th>
            <th className="text-left px-3 py-2 text-slate-500 font-medium hidden md:table-cell">類別</th>
            {weekDates.map(d => (
              <th key={d} className="text-center px-2 py-2 text-slate-500 font-medium whitespace-nowrap">
                {formatDate(d)}
              </th>
            ))}
            <th className="text-center px-2 py-2 text-slate-500 font-medium whitespace-nowrap">
              <span className="flex items-center justify-center gap-1">
                <TrendingUp className="w-3 h-3" />累計
              </span>
            </th>
            <th className="text-center px-2 py-2 text-slate-500 font-medium whitespace-nowrap">上週持有%</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {filtered.map((row, idx) => {
            const isTotalPos = row.total_change > 0
            const isTotalNeg = row.total_change < 0
            return (
              <tr key={row.stock_code} className="hover:bg-slate-50 transition-colors">
                <td className="px-3 py-2 text-slate-400 text-xs text-center">{idx + 1}</td>
                <td className="px-3 py-2">
                  <Link href={`/stock/${row.stock_code}`} className="flex items-center gap-2 group">
                    <div>
                      <span className="font-mono font-semibold text-slate-800 group-hover:text-primary-600">
                        {row.stock_code}
                      </span>
                      {row.stock_name && (
                        <span className="ml-1.5 text-slate-600 text-xs">{row.stock_name}</span>
                      )}
                      {market === 'all' && (
                        <span className="ml-1"><MarketBadge market={row.market} /></span>
                      )}
                    </div>
                  </Link>
                </td>
                <td className="px-3 py-2 text-slate-500 text-xs hidden md:table-cell">
                  {row.industry || '—'}
                </td>
                {weekDates.map(d => (
                  <ChangeCell key={d} value={row.week_changes[d] ?? 0} />
                ))}
                <td className={`text-center px-2 py-2 text-xs font-bold ${
                  isTotalPos ? 'text-red-600' : isTotalNeg ? 'text-green-600' : 'text-slate-400'
                }`}>
                  {row.total_change > 0 ? '+' : ''}{row.total_change.toFixed(2)}
                </td>
                <td className="text-center px-2 py-2 text-slate-700 text-xs font-medium">
                  {row.latest_ratio.toFixed(2)}%
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
