import { StockDetailClient } from './StockDetailClient'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://msh-api.workers.dev'

export async function generateStaticParams() {
  try {
    const res = await fetch(API_BASE + '/api/skill-analysis?market=all&limit=200')
    if (!res.ok) return [{ code: 'placeholder' }]
    const data = await res.json()
    const candidates = Array.isArray(data) ? data : (data.candidates || [])
    if (candidates.length === 0) return [{ code: 'placeholder' }]
    return candidates.map((c) => ({ code: c.stock_code }))
  } catch {
    return [{ code: 'placeholder' }]
  }
}

interface PageProps {
  params: Promise<{ code: string }>
}

export default async function StockDetailPage({ params }: PageProps) {
  const { code } = await params
  return <StockDetailClient code={code} />
}
