import { notFound } from 'next/navigation'
import { GestionCursos } from '@/app/dashboard/cursos/_components/GestionCursos'
import type { CursoConNivel } from '@/services/cursos.service'

/**
 * Banco de pruebas de interfaz para la administración de cursos (EPT-16 / EPT-18).
 *
 * Renderiza el componente real `GestionCursos` con datos fijos, sin tocar la base
 * de datos, para que las pruebas de teclado, foco, estados y diseño responsive
 * de `tests/cursos-ui.spec.ts` sean reproducibles por cualquier revisor.
 *
 * No sustituye a la prueba del camino autenticado real: eso exige una sesión de
 * director contra una base con las migraciones aplicadas.
 *
 * Doble cierre para que nunca se sirva fuera de una corrida de pruebas:
 *   1. queda deshabilitado en cualquier compilación de producción;
 *   2. además exige `EPT_UI_HARNESS=1`, que solo define `playwright.config.ts`.
 * Si falta cualquiera de las dos condiciones responde 404.
 */
export const dynamic = 'force-dynamic'

const NIVELES = [
  { id: 1, nombre: 'INICIAL' },
  { id: 2, nombre: 'PRIMARIO' },
  { id: 3, nombre: 'SECUNDARIO' },
]

const CURSOS: CursoConNivel[] = [
  { id: '1a000000-0000-4000-8000-000000000001', nivel_id: 1, denominacion: 'Sala de 4', division: 'A', activo: true, fecha_creacion: '2026-03-01T10:00:00Z', nivel: { id: 1, nombre: 'INICIAL' } },
  { id: '1a000000-0000-4000-8000-000000000002', nivel_id: 1, denominacion: 'Sala de 5', division: 'B', activo: true, fecha_creacion: '2026-03-01T10:00:00Z', nivel: { id: 1, nombre: 'INICIAL' } },
  { id: '1a000000-0000-4000-8000-000000000003', nivel_id: 2, denominacion: '1er Grado', division: 'A', activo: true, fecha_creacion: '2026-03-01T10:00:00Z', nivel: { id: 2, nombre: 'PRIMARIO' } },
  { id: '1a000000-0000-4000-8000-000000000004', nivel_id: 2, denominacion: '1er Grado', division: 'B', activo: false, fecha_creacion: '2026-03-01T10:00:00Z', nivel: { id: 2, nombre: 'PRIMARIO' } },
  { id: '1a000000-0000-4000-8000-000000000005', nivel_id: 3, denominacion: '3er Año', division: 'C', activo: true, fecha_creacion: '2026-03-01T10:00:00Z', nivel: { id: 3, nombre: 'SECUNDARIO' } },
]

export default async function PruebasCursosPage({
  searchParams,
}: {
  searchParams: Promise<{ vacio?: string }>
}) {
  if (process.env.NODE_ENV === 'production' || process.env.EPT_UI_HARNESS !== '1') {
    notFound()
  }

  const { vacio } = await searchParams

  return (
    <div className="min-h-[100dvh] bg-neutral-50 p-4 lg:p-8">
      <GestionCursos cursos={vacio === '1' ? [] : CURSOS} niveles={NIVELES} />
    </div>
  )
}
