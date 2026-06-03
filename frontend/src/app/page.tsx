'use client'

import { useState } from 'react'
import { SkillDashboard } from '@/components/SkillDashboard'
import { StatsBar } from '@/components/StatsBar'
import { SearchBar } from '@/components/SearchBar'
import { MarketTabs } from '@/components/MarketTabs'

export default function HomePage() {
  const [activeMarket, setActiveMarket] = useState<'all' | 'twse' | 'tpex'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            大股東籌碼分析
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            基於 TDCC 集保股權分散表，篩選籌碼集中起漲潛力標的
          </p>
        </div>
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="搜尋股票代號或名稱..."
        />
      </div>

      <StatsBar />

      <div className="card p-0 overflow-hidden">
        <div className="border-b border-surface-border px-6 pt-4">
          <div className="flex items-center justify-between">
            <MarketTabs active={activeMarket} onChange={setActiveMarket} />
            <div className="text-xs text-slate-400 pb-3">
              更新時間：每週六 16:00
            </div>
          </div>
        </div>
        <SkillDashboard market={activeMarket} searchQuery={searchQuery} />
      </div>
    </div>
  )
}
