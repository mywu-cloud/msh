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

// 定義大股東、中股東、小股東分組
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

export function HolderHeatmap({ data, stockCode, stockName }: Props) {
  if (!data || data.length === 0) {
    return (
            <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
              暫無持股分布數據
            </div>
          )
      }

        // 建立時間序列數據
        const chartData = [...data]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(week => ({
                date: week.date.slice(5), // MM-DD
                fullDate: week.date,
                大股東: parseFloat(groupRatio(week.brackets, BIG_LABELS).toFixed(2)),
                中股東: parseFloat(groupRatio(week.brackets, MID_LABELS).toFixed(2)),
                小股東: parseFloat(groupRatio(week.brackets, SMALL_LABELS).toFixed(2)),
                大股東人數: groupHolders(week.brackets, BIG_LABELS),
                總股東人數: week.brackets.find(b => b.bracket === '合計')?.holders || 0,
          }))

            const CustomTooltip = ({ active, payload, label }: Record<string, unknown>) => {
                  if (!(active as boolean) || !payload) return null
                  const p = payload as Array<{ name: string; value: number; color: string }>
    return (
            <div className="card p-3 text-xs shadow-lg border border-slate-200">
              <div className="font-semibold text-slate-700 mb-1.5">{label as string}</div>
      {p.map((entry) => (
                <div key={entry.name} className="flex items-center gap-2 mb-0.5">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: entry.color }} />
            <span className="text-slate-600">{entry.name}:</span>
                  <span className="font-semibold">{entry.value}%</span>
                </div>
              ))}
            </div>
          )
      }

        return (
          <div className="space-y-6">
      {/* Stacked Area Chart - Ratio Distribution */}
            <div>
              <h4 className="text-sm font-semibold text-slate-700 mb-3">
                持股比例趨勢 ({data.length} 週)
              </h4>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
              tickLine={false}
                              axisLine={false}
                            />
                            <YAxis
                              tick={{ fontSize: 11, fill: '#94a3b8' }}
                              tickLine={false}
                              axisLine={false}
                              tickFormatter={v => `${v}%`}
                            />
                            <Tooltip content={<CustomTooltip />} />
            <Legend
                              wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
                              iconType="circle"
                              iconSize={8}
            />
                            <Area
                              type="monotone"
                              dataKey="大股東"
                              stackId="1"
                              stroke="#e33c3c"
                              fill="#fca5a5"
                              strokeWidth={2}
            />
                            <Area
                              type="monotone"
                              dataKey="中股東"
                              stackId="1"
                              stroke="#f97316"
                              fill="#fed7aa"
                              strokeWidth={2}
            />
                            <Area
                              type="monotone"
                              dataKey="小股東"
                              stackId="1"
                              stroke="#94a3b8"
                              fill="#e2e8f0"
                              strokeWidth={1.5}
            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>

                {/* Line Chart - Holder Count */}
                      <div>
                        <h4 className="text-sm font-semibold text-slate-700 mb-3">
                          總股東人數趨勢
                          <span className="ml-2 text-xs font-normal text-slate-400">
                            (下降代表籌碼集中)
                          </span>
                        </h4>
                        <ResponsiveContainer width="100%" height={160}>
                          <LineChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                            <XAxis
                              dataKey="date"
                              tick={{ fontSize: 11, fill: '#94a3b8' }}
              tickLine={false}
                              axisLine={false}
                            />
                            <YAxis
                              tick={{ fontSize: 11, fill: '#94a3b8' }}
                              tickLine={false}
                              axisLine={false}
                              tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
                            />
                            <Tooltip
                              formatter={(v: number) => [v.toLocaleString(), '股東人數']}
                              contentStyle={{ fontSize: 12, borderRadius: 6 }}
            />
                            <Line
                              type="monotone"
                              dataKey="總股東人數"
                              stroke="#3b82f6"
                              strokeWidth={2}
                              dot={{ r: 3, fill: '#3b82f6' }}
                              activeDot={{ r: 5 }}
            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )
                }
