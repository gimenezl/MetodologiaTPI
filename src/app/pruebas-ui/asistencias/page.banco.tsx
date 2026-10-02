import { notFound } from 'next/navigation'
import { BancoAsistencias } from './BancoAsistencias'

export const dynamic = 'force-dynamic'

export default async function BancoDeAsistencias({ searchParams }: { searchParams: Promise<{ vista?: string }> }) {
  if (process.env.NODE_ENV === 'production' || process.env.EPT_UI_HARNESS !== '1') notFound()
  const { vista } = await searchParams
  return (
    <main className="p-4">
      <BancoAsistencias vista={vista ?? 'docente'} />
    </main>
  )
}
