'use client'

import { useEffect, useState } from 'react'

import { THEME_KEY } from './theme-script'

export type Theme = 'light' | 'dark'
export { THEME_KEY }
export function getTheme(): Theme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function setTheme(t: Theme, persist = true) {
  const d = document.documentElement
  d.classList.toggle('dark', t === 'dark')
  d.style.colorScheme = t
  if (persist) {
    try { localStorage.setItem(THEME_KEY, t) } catch {}
  }
  window.dispatchEvent(new CustomEvent('msh-theme-change', { detail: t }))
}

/** Reactive current theme (follows toggle and, when the user has not chosen, the OS setting). */
export function useTheme(): Theme {
  const [theme, setT] = useState<Theme>('light')
  useEffect(() => {
    setT(getTheme())
    const onChange = () => setT(getTheme())
    window.addEventListener('msh-theme-change', onChange)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onSystem = (e: MediaQueryListEvent) => {
      let saved: string | null = null
      try { saved = localStorage.getItem(THEME_KEY) } catch {}
      if (saved !== 'light' && saved !== 'dark') setTheme(e.matches ? 'dark' : 'light', false)
    }
    mq.addEventListener?.('change', onSystem)
    return () => {
      window.removeEventListener('msh-theme-change', onChange)
      mq.removeEventListener?.('change', onSystem)
    }
  }, [])
  return theme
}

/** Chart palette that adapts to the theme (Recharts takes literal colours). */
export function useChartColors() {
  const dark = useTheme() === 'dark'
  return {
    grid: dark ? '#2b384d' : '#e2e8f0',
    axis: dark ? '#94a3b8' : '#64748b',
    volume: dark ? '#64748b' : '#94a3b8',
    tooltipBg: dark ? '#131b2a' : '#ffffff',
    tooltipBorder: dark ? '#2b384d' : '#e2e8f0',
    tooltipText: dark ? '#e9eef5' : '#0f172a',
    up: dark ? '#ff6b6b' : '#ef4444',
    down: dark ? '#34d399' : '#22c55e',
    blue: dark ? '#60a5fa' : '#3b82f6',
    amber: '#f59e0b',
    upFill: dark ? 'rgba(239,68,68,0.35)' : '#fecaca',
    amberFill: dark ? 'rgba(245,158,11,0.35)' : '#fde68a',
    downFill: dark ? 'rgba(34,197,94,0.35)' : '#bbf7d0',
  }
}
