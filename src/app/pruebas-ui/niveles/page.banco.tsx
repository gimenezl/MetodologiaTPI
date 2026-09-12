import { notFound } from 'next/navigation'
import NivelesLoading from '@/app/dashboard/niveles/loading'
import { GestionNiveles } from '@/app/dashboard/niveles/_components/GestionNiveles'
import type { NivelAdministrable } from '@/services/niveles.service'

/**
 * Banco visual determinista. Solo existe en desarrollo y además exige la
 * variable que Playwright define para los harness de interfaz.
 */
export const dynamic = 'force-dynamic'

const NIVELES: NivelAdministrable[] = [
  {
    id: 1,
    nombre: 'INICIAL',
    activo: true,
    orden: 10,
    es_institucional: true,
  },
  {
    id: 2,
    nombre: 'PRIMARIO',
    activo: true,
    orden: 20,
    es_institucional: true,
  },
  {
    id: 3,
    nombre: 'SECUNDARIO',
    activo: false,
    orden: 30,
    es_institucional: true,
  },
  {
    id: 4,
    nombre: 'FORMACIÓN PROFESIONAL',
    activo: true,
    orden: 40,
    es_institucional: false,
  },
  {
    id: 5,
    nombre: 'ACOMPAÑAMIENTO ACADÉMICO',
    activo: false,
    orden: 50,
    es_institucional: false,
  },
]

export default async function PruebasNivelesPage({
  searchParams,
}: {
  searchParams: Promise<{
    vacio?: string
    estado?: 'carga' | 'error' | 'exito'
  }>
}) {
  if (process.env.NODE_ENV === 'production' || process.env.EPT_UI_HARNESS !== '1') {
    notFound()
  }

  const { vacio, estado } = await searchParams

  if (estado === 'carga') {
    return (
      <div className="min-h-[100dvh] bg-neutral-50 p-4 lg:p-8">
        <NivelesLoading />
      </div>
    )
  }

  const mensajeInicial =
    estado === 'error'
      ? ({
          tipo: 'error',
          texto: 'No pudimos guardar el cambio. Revisá los datos y volvé a intentarlo.',
        } as const)
      : estado === 'exito'
        ? ({ tipo: 'exito', texto: 'Nivel actualizado correctamente.' } as const)
        : undefined

  return (
    <div className="min-h-[100dvh] bg-neutral-50 p-4 lg:p-8">
      <GestionNiveles
        niveles={vacio === '1' ? [] : NIVELES}
        mensajeInicial={mensajeInicial}
      />
    </div>
  )
}
