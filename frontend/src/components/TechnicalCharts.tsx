'use client'
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
} from 'recharts'
import { useChartColors } from '@/lib/theme'

interface TechnicalPoint {
  date: string
  close: number
  volume: number
  k: number
  d: number
  dif: number
  dea: number
  hist: number
}

interface Props {
  series: TechnicalPoint[]
}

// series dates come as "YYYYMMDD" strings from the backend/FinMind
function formatDate(d: string): string {
  if (!d || d.length < 8) return d
  return `${d.slice(4, 6)}/${d.slice(6, 8)}`
}

export function TechnicalCharts({ series }: Props) {
  const cc = useChartColors()
  const tip = { contentStyle: { background: cc.tooltipBg, borderColor: cc.tooltipBorder, color: cc.tooltipText, borderRadius: 6 }, labelStyle: { color: cc.tooltipText } }
  if (!series || series.length === 0) return null

  const chartData = [...series]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(p => ({
      date: formatDate(p.date),
      fullDate: p.date,
      收盤: p.close,
      成交量: p.volume,
      K: parseFloat(p.k.toFixed(1)),
      D: parseFloat(p.d.toFixed(1)),
      DIF: parseFloat(p.dif.toFixed(2)),
      MACD: parseFloat(p.dea.toFixed(2)),
      柱狀圖: parseFloat(p.hist.toFixed(2)),
    }))

  return (
    <div className="space-y-6 mb-6">
      <div>
        <h3 className="text-sm font-medium text-slate-600 mb-2">日成交量（股）</h3>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: cc.axis }} stroke={cc.grid} />
            <YAxis
              tick={{ fontSize: 11, fill: cc.axis }} stroke={cc.grid}
              tickFormatter={(v: number) => (v >= 10000 ? `${(v / 10000).toFixed(0)}萬` : String(v))}
            />
            <Tooltip {...tip} formatter={(v: number) => v.toLocaleString()} />
            <Bar dataKey="成交量" fill={cc.volume} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h3 className="text-sm font-medium text-slate-600 mb-2">K值 / D值</h3>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: cc.axis }} stroke={cc.grid} />
            <YAxis tick={{ fontSize: 11, fill: cc.axis }} stroke={cc.grid} domain={[0, 100]} />
            <Tooltip {...tip} />
            <Legend />
            <Line type="monotone" dataKey="K" stroke={cc.blue} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="D" stroke={cc.amber} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h3 className="text-sm font-medium text-slate-600 mb-2">MACD（DIF / MACD / 柱狀圖）</h3>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: cc.axis }} stroke={cc.grid} />
            <YAxis tick={{ fontSize: 11, fill: cc.axis }} stroke={cc.grid} />
            <Tooltip {...tip} />
            <Legend />
            <Bar dataKey="柱狀圖">
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.柱狀圖 >= 0 ? cc.up : cc.down} />
              ))}
            </Bar>
            <Line type="monotone" dataKey="DIF" stroke={cc.blue} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="MACD" stroke={cc.amber} strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
