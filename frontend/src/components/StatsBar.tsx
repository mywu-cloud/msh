'use client'
import useSWR from 'swr'
import { Database, TrendingUp, Users, Clock } from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://msh-api.tw-mywu.workers.dev'
const fetcher = (url: string) => fetch(url).then(r => r.json())

export function StatsBar() {
  const { data } = useSWR(`${API_BASE}/api/stats`, fetcher, { refreshInterval: 3600000 })
  const statsData = data?.data
  const stats = [
    { icon: Database, label: '追蹤股票', value: statsData?.total_stocks ? `${statsData.total_stocks.toLocaleString()} 殔` : '—' },
    { icon: TrendingUp, label: '資料週數', value: statsData?.total_weeks ? `${statsData.total_weeks} 週` : '—' },
    { icon: Users, label: '最新日期', value: statsData?.latest_date || '—' },
    { icon: Clock, label: '最後更新', value: '每週六 16:00' },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {stats.map(({ icon: Icon, label, value }) => (
        <div key={label} className="card flex items-center gap-3 py-3 px-4">
          <div className="w-8 h-8 rounded-lg bg-brand/10 flex items-center justify-center flex-shrink-0">
            <Icon className="w-4 h-4 text-brand" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-gray-500 truncate">{label}</p>
            <p className="font-semibold text-sm truncate">{value}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
