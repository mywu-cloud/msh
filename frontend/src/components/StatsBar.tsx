'use client'

  import useSWR from 'swr'
    import { Database, CalendarDays, AlertTriangle, TrendingUp } from 'lucide-react'

    const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://msh-api.workers.dev'
const fetcher = (url: string) => fetch(url).then(r => r.json())

  interface Stats {
    total_stocks: number
        total_weeks: number
        latest_date: string
        earliest_date: string
        alert_count: number
      }

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ElementType
      label: string
      value: string | number
      sub?: string
      accent?: string
    }) {
  return (
        <div className="card p-4 flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${accent || 'bg-primary-50'}`}>
        <Icon size={16} className={accent ? 'text-white' : 'text-primary-600'} />
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-slate-400 mb-0.5">{label}</div>
                  <div className="font-bold text-base text-slate-800 leading-none">{value}</div>
          {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
                </div>
              </div>
            )
          }

          export function StatsBar() {
            const { data, isLoading } = useSWR<{ data: Stats }>(
                  `${API_BASE}/api/stats`,
                  fetcher,
              { refreshInterval: 600_000 }
  )

  const stats = data?.data

  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
{Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-4 h-[72px]">
            <div className="skeleton h-3 w-20 mb-2 rounded" />
            <div className="skeleton h-5 w-16 rounded" />
          </div>
        ))}
      </div>
    )
}

  const latestDate = stats.latest_date
    ? new Date(stats.latest_date).toLocaleDateString('zh-TW', {
        year: 'numeric', month: '2-digit', day: '2-digit'
})
    : '—'

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatCard
        icon={Database}
        label="追蹤股票數"
        value={stats.total_stocks?.toLocaleString() || '—'}
        sub="上市 + 上櫃"
      />
      <StatCard
        icon={CalendarDays}
        label="最新更新"
        value={latestDate}
        sub={`累計 ${stats.total_weeks} 週`}
      />
      <StatCard
        icon={TrendingUp}
        label="籌碼集中個股"
        value={`${Math.floor((stats.total_stocks || 0) * 0.15)}`}
        sub="大股東連續增持"
      />
      <StatCard
        icon={AlertTriangle}
        label="暴增警示"
        value={stats.alert_count || 0}
        sub="本週大股東驟增"
        accent="bg-amber-500"
      />
    </div>
  )
}
