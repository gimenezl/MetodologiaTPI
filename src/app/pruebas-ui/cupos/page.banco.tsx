import { notFound } from 'next/navigation'
import { BancoCupos } from './BancoCupos'

export const dynamic = 'force-dynamic'

export default async function BancoDeCupos({ searchParams }: { searchParams: Promise<{ vista?: string }> }) {
  if (process.env.NODE_ENV === 'production' || process.env.EPT_UI_HARNESS !== '1') notFound()
  const { vista } = await searchParams
  return (
    <main className="p-4">
      <BancoCupos vista={vista ?? 'estudiante'} />
    </main>
  )
}
