import { StockDetailClient } from './StockDetailClient'

export function generateStaticParams() {
  return []
}

interface PageProps {
  params: Promise<{ code: string }>
}

export default async function StockDetailPage({ params }: PageProps) {
  const { code } = await params
  return <StockDetailClient code={code} />
}
