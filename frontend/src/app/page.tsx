'use client'

import { useState } from 'react'
import { SkillDashboard } from '@/components/SkillDashboard'
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
            大股東持有比率週增減排行
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            大股東持有比率週增減排行，按累計增幅由高至低排序
          </p>
        </div>
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="搜尋股票代號或名稱..."
        />
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="border-b border-surface-border px-6 pt-4">
          <div className="flex items-center justify-between">
            <MarketTabs active={activeMarket} onChange={setActiveMarket} />
            <div className="text-xs text-slate-400 pb-3">
              資料來源：集保所 TDCC
            </div>
          </div>
        </div>
        <SkillDashboard market={activeMarket} searchQuery={searchQuery} />
      </div>
    </div>
  )
}
