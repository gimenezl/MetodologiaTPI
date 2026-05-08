import type { Metadata } from 'next'
import { obtenerNoticiasPaginadas } from '@/services/noticias.service'
import { NoticiasClient } from './NoticiasClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Noticias',
  description: 'Últimas novedades, eventos y comunicados del Centro Educativo Educar para Transformar.',
}

export default async function NoticiasPage({ searchParams }: { searchParams?: Promise<{ page?: string }> }) {
  const pageSize = 9
  const resolvedParams = await searchParams
  const currentPage = Math.max(1, Number(resolvedParams?.page ?? '1') || 1)
  let noticias: any[] = []
  let totalPages = 1
  try {
    const { data, count } = await obtenerNoticiasPaginadas(currentPage, pageSize)
    noticias = data ?? []
    totalPages = Math.max(1, Math.ceil(count / pageSize))
  } catch {
    noticias = []
  }

  return (
    <NoticiasClient
      noticias={noticias}
      currentPage={currentPage}
      totalPages={totalPages}
    />
  )
}
