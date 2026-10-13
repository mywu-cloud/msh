'use client'

import { Moon, Sun } from 'lucide-react'
import { setTheme, useTheme } from '@/lib/theme'

export function ThemeToggle({ className = '' }: { className?: string }) {
  const theme = useTheme()
  const isDark = theme === 'dark'
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? '切換為淺色模式' : '切換為深色模式'}
      title={isDark ? '切換為淺色模式' : '切換為深色模式'}
      className={`inline-flex items-center justify-center w-9 h-9 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-800 transition-colors ${className}`}
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  )
}
