import { StockDetailClient } from './StockDetailClient'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://msh-api.tw-mywu.workers.dev'

export async function generateStaticParams() {
  try {
    const res = await fetch(API_BASE + '/api/all-stocks', { next: { revalidate: 3600 } })
    if (!res.ok) return [{ code: 'placeholder' }]
    const data = await res.json() as { stocks?: Array<{ stock_code: string }> }
    const stocks = data?.stocks || []
    if (stocks.length === 0) return [{ code: 'placeholder' }]
    return stocks.map((s) => ({ code: s.stock_code }))
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
