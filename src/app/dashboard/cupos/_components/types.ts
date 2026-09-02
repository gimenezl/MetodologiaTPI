export type ActividadConCupo = {
  id: number
  nombre: string
  tipo: string | null
  cupo_maximo: number
  inscriptos: number
  cupo_disponible: number
  porcentaje_ocupacion: number
  nivel: { nombre: string } | null
}

export type Inscripcion = {
  id: string
  estudiante: { id: string; nombre: string; apellido: string; legajo_nro: string | null } | null
}

export type Estudiante = {
  id: string
  nombre: string
  apellido: string
  legajo_nro: string | null
}

export type Rol = { id: number; nombre: string }

export type PropiedadesVistaCupos = {
  actividades: ActividadConCupo[]
  cargando: boolean
  recargarActividades: () => Promise<void>
}

export const variantePorTipo: Record<string, 'info' | 'success' | 'warning'> = {
  DEPORTE: 'success',
  CURRICULAR: 'info',
  TALLER: 'warning',
}
