'use client'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LineChart,
  Line,
} from 'recharts'

interface BracketRow {
  date: string
  bracket: string
  ratio: number
  holders: number
  shares: number
}

interface WeekData {
  date: string
  brackets: BracketRow[]
}

interface Props {
  data: WeekData[]
  stockCode: string
  stockName?: string
}

const BIG_LABELS = ['400,001以上', '200,001-400,000', '100,001-200,000', '50,001-100,000']
const MID_LABELS = ['40,001-50,000', '30,001-40,000', '20,001-30,000', '10,001-20,000']
const SMALL_LABELS = ['5,001-10,000', '1,000-5,000', '1-999']

function groupRatio(brackets: BracketRow[], labels: string[]): number {
  return brackets
    .filter(b => labels.some(l => b.bracket.includes(l.split('-')[0]) || b.bracket === l))
    .reduce((sum, b) => sum + (b.ratio || 0), 0)
}

function groupHolders(brackets: BracketRow[], labels: string[]): number {
  return brackets
    .filter(b => labels.some(l => b.bracket.includes(l.split('-')[0]) || b.bracket === l))
    .reduce((sum, b) => sum + (b.holders || 0), 0)
}

// Zoom a Y-axis into the actual data range instead of forcing it to start at 0,
// so week-over-week fluctuations are clearly visible instead of looking flat.
function computeZoomDomain(values: number[], paddingRatio = 0.2, minFloor = 0): [number, number] {
  const finite = values.filter(v => Number.isFinite(v))
  if (finite.length === 0) return [0, 1]
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.1, 1)
    return [Math.max(minFloor, min - pad), max + pad]
  }
  const pad = (max - min) * paddingRatio
  return [Math.max(minFloor, min - pad), max + pad]
}

export function HolderHeatmap({ data, stockCode, stockName }: Props) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
        暫無持股分布數據
      </div>
    )
  }

  const chartData = [...data]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(week => ({
      date: week.date.slice(5),
      fullDate: week.date,
      大股東: parseFloat(groupRatio(week.brackets, BIG_LABELS).toFixed(2)),
      中股東: parseFloat(groupRatio(week.brackets, MID_LABELS).toFixed(2)),
      小股東: parseFloat(groupRatio(week.brackets, SMALL_LABELS).toFixed(2)),
      總股東人數: week.brackets.reduce((s, b) => s + (b.holders || 0), 0),
    }))

  const totalHoldersData = [...data]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(week => ({
      date: week.date.slice(5),
      大股東人數: groupHolders(week.brackets, BIG_LABELS),
      中股東人數: groupHolders(week.brackets, MID_LABELS),
      小股東人數: groupHolders(week.brackets, SMALL_LABELS),
      總股東人數: week.brackets.reduce((s, b) => s + (b.holders || 0), 0),
    }))

  const bigRatioDomain = computeZoomDomain(chartData.map(d => d.大股東), 0.25, 0)
  const holderCountDomain = computeZoomDomain(totalHoldersData.map(d => d.總股東人數).filter(v => v > 0), 0.15, 0)

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-slate-600 mb-2">持股比例分布趨勢</h3>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} unit="%" />
            <Tooltip formatter={(v: number) => v.toFixed(2) + '%'} />
            <Legend />
            <Area type="monotone" dataKey="大股東" stackId="1" stroke="#ef4444" fill="#fecaca" />
            <Area type="monotone" dataKey="中股東" stackId="1" stroke="#f59e0b" fill="#fde68a" />
            <Area type="monotone" dataKey="小股東" stackId="1" stroke="#22c55e" fill="#bbf7d0" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div>
        <h3 className="text-sm font-medium text-slate-600 mb-2">大股東持有比率趨勢（局部放大）</h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} unit="%" domain={bigRatioDomain} allowDecimals={true} />
            <Tooltip formatter={(v: number) => v.toFixed(2) + '%'} />
            <Line type="monotone" dataKey="大股東" name="大股東%" stroke="#ef4444" strokeWidth={2} dot={{ r: 3, fill: '#ef4444' }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div>
        <h3 className="text-sm font-medium text-slate-600 mb-2">股東人數趨勢（局部放大）</h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={totalHoldersData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} domain={holderCountDomain} allowDecimals={false} />
            <Tooltip />
            <Line type="monotone" dataKey="總股東人數" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3, fill: '#3b82f6' }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
