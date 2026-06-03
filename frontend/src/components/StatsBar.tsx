'use client'
import useSWR from 'swr'
import { Database, TrendingUp, Users, Clock } from 'lucide-react'
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://msh-api.workers.dev'
const fetcher = (url: string) => fetch(url).then(r => r.json())
export function StatsBar() {
  const { data } = useSWR(`${API_BASE}/api/stats`, fetcher, { refreshInterval: 3600000 })
  const stats = [
    { icon: Database, label: '追蹤股票', value: data?.total_stocks ? `${data.total_stocks.toLocaleString()} 殔` : '—' },
    { icon: TrendingUp, label: '本期分析', value: data?.analyzed_stocks ? `${data.analyzed_stocks} 殔` : '—' },
    { icon: Users, label: '持股分布筆數', value: data?.total_records ? `${(data.total_records/10000).toFixed(1)} 萬` : '—' },
    { icon: Clock, label: '最後更新', value: data?.last_updated || '每週六 16:00' },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {stats.map(({ icon: Icon, label, value }) => (
        <div key={label} className="card flex items-center gap-3 py-3 px-4">
          <div className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center flex-shrink-0">
            <Icon className="w-4 h-4 text-primary-600" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-slate-500 truncate">{label}</p>
            <p className="text-sm font-semibold text-slate-800 truncate">{value}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
