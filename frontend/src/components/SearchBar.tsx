'use client'
import { Search } from 'lucide-react'

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}

export function SearchBar({ value, onChange, placeholder = '搜尋...' }: Props) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-9 pr-4 py-2 w-full sm:w-64 border border-surface-border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-300"
      />
    </div>
  )
}
