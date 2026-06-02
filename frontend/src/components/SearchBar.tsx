import { Search, X } from 'lucide-react'

  interface Props {
    value: string
    onChange: (v: string) => void
    placeholder?: string
  }

  export function SearchBar({ value, onChange, placeholder = '搜尋...' }: Props) {
  return (
        <div className="relative w-full sm:w-64">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
          <input
            type="text"
            value={value}
        onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            className="search-input pl-8 pr-8"
          />
    {value && (
            <button
              onClick={() => onChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X size={14} />
            </button>
          )}
        </div>
      )
    }
