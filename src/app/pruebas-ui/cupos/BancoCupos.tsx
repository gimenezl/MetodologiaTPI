'use client'

import { VistaEstudiante } from '@/app/dashboard/cupos/_components/VistaEstudiante'
import { VistaPadre } from '@/app/dashboard/cupos/_components/VistaPadre'
import { VistaGestionCupos } from '@/app/dashboard/cupos/_components/VistaGestionCupos'
import type { ActividadConCupo } from '@/app/dashboard/cupos/_components/types'

/**
 * Banco de pruebas de la pantalla de cupos (EPT-66). Renderiza las vistas reales
 * por rol con actividades de relleno; los datos de las funciones de PostgreSQL
 * los simula la prueba interceptando las peticiones del navegador. Los
 * identificadores y nombres son sintéticos.
 */
export const PERFIL_ESTUDIANTE = 'eeeeeeee-6600-4000-8000-000000000001'

const ACTIVIDADES: ActividadConCupo[] = [
  {
    id: 701, nombre: 'Taller de teatro', tipo: 'TALLER', cupo_maximo: 10, inscriptos: 3,
    cupo_disponible: 7, porcentaje_ocupacion: 30, nivel: { nombre: 'PRIMARIO' },
  },
  {
    id: 702, nombre: 'Taller de ajedrez', tipo: 'TALLER', cupo_maximo: 2, inscriptos: 2,
    cupo_disponible: 0, porcentaje_ocupacion: 100, nivel: { nombre: 'PRIMARIO' },
  },
  {
    id: 703, nombre: 'Fútbol (histórico)', tipo: 'DEPORTE', cupo_maximo: 25, inscriptos: 4,
    cupo_disponible: 21, porcentaje_ocupacion: 16, nivel: null,
  },
]

export function BancoCupos({ vista }: { vista: string }) {
  const comunes = { actividades: ACTIVIDADES, cargando: false, recargarActividades: async () => {} }
  if (vista === 'padre') return <VistaPadre {...comunes} />
  if (vista === 'director') return <VistaGestionCupos {...comunes} rol="DIRECTOR" />
  if (vista === 'docente') return <VistaGestionCupos {...comunes} rol="DOCENTE" />
  return <VistaEstudiante {...comunes} perfilId={PERFIL_ESTUDIANTE} />
}
