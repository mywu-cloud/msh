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

// Bracket codes returned by the backend are numeric strings ("1" ~ "17"), where
// 17 is the 合計 (total) row and must be excluded from any per-category sum.
// Classification follows the same convention already used by the backend's
// big-holder-ratio ranking query (bracket >= 10 AND bracket != 17 = 大股東):
//   1-3   = 小股東 (持股 <=10,000 股)
//   4-9   = 中股東 (持股 10,001-100,000 股)
//   10-16 = 大股東 (持股 100,001 股以上)
type HolderCategory = 'big' | 'mid' | 'small'

function bracketCategory(bracket: string): HolderCategory | null {
  const n = Number(bracket)
  if (!Number.isFinite(n) || n === 17) return null
  if (n >= 10) return 'big'
  if (n >= 4) return 'mid'
  if (n >= 1) return 'small'
  return null
}

function groupRatio(brackets: BracketRow[], category: HolderCategory): number {
  return brackets
    .filter(b => bracketCategory(b.bracket) === category)
    .reduce((sum, b) => sum + (b.ratio || 0), 0)
}

function groupHolders(brackets: BracketRow[], category: HolderCategory): number {
  return brackets
    .filter(b => bracketCategory(b.bracket) === category)
    .reduce((sum, b) => sum + (b.holders || 0), 0)
}

// The "17" bracket row from the source data IS the 合計 (total) row, so use it
// directly instead of summing all brackets (which would double-count holders).
// Some historical weeks only have partial bracket data (backend still backfilling),
// leaving this row's holders at 0. Treat that as "no data" (null) rather than a real
// 0 so charts show a gap instead of forcing the Y-axis back down to 0.
function totalHolders(brackets: BracketRow[]): number | null {
  const totalRow = brackets.find(b => Number(b.bracket) === 17)
  return totalRow && totalRow.holders > 0 ? totalRow.holders : null
}

// Zoom a Y-axis into the actual data range instead of forcing it to start at 0,
// so week-over-week fluctuations are clearly visible instead of looking flat.
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function computeZoomDomain(values: number[], paddingRatio = 0.2, minFloor = 0): [number, number] {
  const finite = values.filter(v => Number.isFinite(v))
  if (finite.length === 0) return [0, 1]
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.1, 1)
    return [round2(Math.max(minFloor, min - pad)), round2(max + pad)]
  }
  const pad = (max - min) * paddingRatio
  return [round2(Math.max(minFloor, min - pad)), round2(max + pad)]
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
      大股東: parseFloat(groupRatio(week.brackets, 'big').toFixed(2)),
      中股東: parseFloat(groupRatio(week.brackets, 'mid').toFixed(2)),
      小股東: parseFloat(groupRatio(week.brackets, 'small').toFixed(2)),
      總股東人數: totalHolders(week.brackets),
    }))

  const totalHoldersData = [...data]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(week => ({
      date: week.date.slice(5),
      大股東人數: groupHolders(week.brackets, 'big'),
      中股東人數: groupHolders(week.brackets, 'mid'),
      小股東人數: groupHolders(week.brackets, 'small'),
      總股東人數: totalHolders(week.brackets),
    }))

  const bigRatioDomain = computeZoomDomain(chartData.map(d => d.大股東), 0.25, 0)
  const holderCountDomain = computeZoomDomain(totalHoldersData.map(d => d.總股東人數).filter((v): v is number => v !== null && v > 0), 0.15, 0)
  // The composition chart is a 100%-stacked area (大股東+中股東+小股東 sum to the
  // reported total each week). Some historical weeks only have partial data, so
  // the stacked total can sit well below 100%, making week-over-week changes in
  // the upper bands hard to see against a full 0-100% axis. Zoom the bottom of
  // the axis into the actual data range (capped at 100% on top, since the stack
  // never exceeds that) so proportional changes are clearer.
  const stackedTotals = chartData.map(d => d.大股東 + d.中股東 + d.小股東)
  const [stackedRatioMin, stackedRatioMaxRaw] = computeZoomDomain(stackedTotals, 0.2, 0)
  const stackedRatioDomain: [number, number] = [stackedRatioMin, Math.min(100, stackedRatioMaxRaw)]

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-slate-600 mb-2">持股比例分布趨勢</h3>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} unit="%" domain={stackedRatioDomain} allowDecimals={true} />
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
