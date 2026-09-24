import { notFound } from 'next/navigation'
import { InscripcionHijos } from '@/app/dashboard/hijos/_components/InscripcionHijos'
import Loading from '@/app/dashboard/hijos/loading'
import type { Hijo, CursoDisponible } from '@/services/hijos.service'

export const dynamic = 'force-dynamic'

const hijos: Hijo[] = [
  {
    id: 'eeeeeeee-1300-4000-8000-000000000101',
    nombre: 'Lara', apellido: 'Vinculada', legajo_nro: 'LEG-PRUEBA-0011',
    estado: 'INACTIVO', matricula_id: null, curso_denominacion: null,
    curso_division: null, nivel_nombre: null,
    materias: [], deportes: [],
  },
  {
    id: 'eeeeeeee-1300-4000-8000-000000000102',
    nombre: 'Mateo', apellido: 'Vinculado', legajo_nro: 'LEG-PRUEBA-0012',
    estado: 'ACTIVO', matricula_id: 'eeeeeeee-1300-4000-8000-000000000103',
    curso_denominacion: '1er Grado', curso_division: 'A', nivel_nombre: 'PRIMARIO',
    materias: [{ materia: 'Ciencias Naturales', docente: 'Elena Ruiz' }],
    deportes: [{ deporte: 'Vóley', grupo: 'Equipo inicial' }],
  },
]

const cursos: CursoDisponible[] = [{
  id: 'eeeeeeee-1300-4000-8000-000000000104',
  denominacion: '1er Grado', division: 'A', nivel: { nombre: 'PRIMARIO' },
}]

export default async function BancoHijos({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  if (process.env.NODE_ENV === 'production' || process.env.EPT_UI_HARNESS !== '1') notFound()
  const { estado } = await searchParams
  if (estado === 'carga') return <Loading />
  return <InscripcionHijos
    iniciales={estado === 'vacio' ? [] : hijos}
    cursos={estado === 'sin-cursos' ? [] : cursos}
  />
}
