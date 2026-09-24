/**
 * Tipos de base de datos escritos a mano.
 *
 * ESTE ARCHIVO NO ES GENERADO. `database.generated.ts`, en esta misma carpeta,
 * sí lo es: sale de `supabase gen types typescript --local` contra una base
 * reconstruida desde cero con la cadena completa de migraciones. Se conserva
 * como artefacto de referencia para poder comparar.
 *
 * Reconciliación verificada entre este archivo y el esquema real (016):
 *
 * - 016 (EPT-13) agrega lectura RLS parental sobre `alumnos` y `matriculas`
 *   y las funciones públicas `matricular_hijo` y `consultar_detalle_hijo`.
 *   La primera retorna el UUID de la matrícula creada; la segunda proyecta
 *   asignaciones y deportes activos sin ampliar lectura directa de tablas.
 *   No añade tablas ni columnas.
 * - 015 (EPT-12) agrega `horarios`, `grupos_deportivos_horarios` y las
 *   funciones públicas `agregar_horario_grupo_deportivo`,
 *   `dar_de_baja_horario_grupo_deportivo`, `inscribir_alumno_en_grupo_deportivo`,
 *   `consultar_compatibilidad_horaria` y
 *   `consultar_compatibilidad_horaria_alumno`. En las dos consultas, las
 *   columnas `conflicto_*` admiten `null` (no hay conflicto); el generador las
 *   tipa como no nulas por la misma razón que en `listar_grupos_deportivos`.
 *   Las horas (`TIME`) llegan como texto `HH:MM:SS`.
 * - 014 (EPT-11) agrega `deportes`, `grupos_deportivos`,
 *   `inscripciones_deportivas`, la vista `inscripciones_deportivas_detalle`, el
 *   tipo enumerado `estado_inscripcion_deportiva` y las funciones públicas
 *   `listar_grupos_deportivos`, `crear_grupo_deportivo`,
 *   `inscribir_en_grupo_deportivo` y `cancelar_inscripcion_deportiva`. En
 *   `listar_grupos_deportivos`, `profesor_id` e `inscripcion_propia_id` admiten
 *   `null` (el estudiante no recibe el identificador del profesor y la
 *   inscripción propia existe solo si la hay); el generador las tipa como
 *   `string` porque PostgreSQL no declara nulabilidad en columnas de retorno.
 * - `cursos`, `padres_hijos`, `opiniones.aprobado` y las funciones públicas de
 *   la aplicación están representados por las migraciones y por los tipos
 *   generados.
 * - 013 (EPT-10) agrega `servicios_escolares`, `inscripciones_servicios`, la
 *   vista `inscripciones_servicios_detalle`, los tipos enumerados
 *   `tipo_servicio_escolar` y `estado_inscripcion_servicio`, y las funciones
 *   públicas `rol_actual`, `inscribir_en_servicio` y
 *   `cancelar_inscripcion_servicio`. La vista se declara solo con `Row`, por
 *   la misma razón que las de 012.
 * - 012 (EPT-56) agrega `actividades.activo`, `materias_cursos`, las vistas
 *   `materias` y `materias_cursos_detalle` y seis funciones de materias. Las
 *   vistas se declaran solo con `Row`: el generador también les asigna
 *   `Insert`/`Update` porque PostgREST las considera actualizables, pero ningún
 *   rol de aplicación tiene privilegios de escritura sobre ellas.
 * - `cambiar_profesor_asignacion.p_profesor_id` admite `null` para quitar el
 *   profesor responsable. El generador lo tipa como `string` porque PostgreSQL
 *   no declara nulabilidad en argumentos; acá se refleja el contrato real.
 * - `rol_actual` devuelve `null` cuando la sesión autenticada no tiene perfil.
 *   El generador lo tipa como `string` por la misma razón: PostgreSQL no
 *   declara la nulabilidad del valor de retorno. Acá se refleja el contrato
 *   real, del que depende `requerirRol` para denegar a una cuenta sin perfil.
 * - Este archivo continúa siendo el contrato manual importado por la
 *   aplicación; `database.generated.ts` es la evidencia reproducible del
 *   esquema y no se edita a mano.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      roles: {
        Row: { id: number; nombre: string }
        Insert: { id?: number; nombre: string }
        Update: { id?: number; nombre?: string }
      }
      perfiles: {
        Row: {
          id: string
          user_id: string | null
          rol_id: number | null
          nombre: string
          apellido: string
          dni: string
          direccion: string | null
          telefono: string | null
          legajo_nro: string | null
          fecha_nacimiento: string | null
          fecha_creacion: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          rol_id?: number | null
          nombre: string
          apellido: string
          dni: string
          direccion?: string | null
          telefono?: string | null
          legajo_nro?: string | null
          fecha_nacimiento?: string | null
          fecha_creacion?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          rol_id?: number | null
          nombre?: string
          apellido?: string
          dni?: string
          direccion?: string | null
          telefono?: string | null
          legajo_nro?: string | null
          fecha_nacimiento?: string | null
          fecha_creacion?: string
        }
      }
      niveles: {
        Row: {
          activo: boolean
          es_institucional: boolean
          id: number
          nombre: string
          orden: number
        }
        Insert: {
          activo?: boolean
          es_institucional?: boolean
          id?: number
          nombre: string
          orden: number
        }
        Update: {
          activo?: boolean
          es_institucional?: boolean
          id?: number
          nombre?: string
          orden?: number
        }
      }
      cursos: {
        Row: {
          id: string
          nivel_id: number
          denominacion: string
          division: string
          activo: boolean
          fecha_creacion: string
        }
        Insert: {
          id?: string
          nivel_id: number
          denominacion: string
          division: string
          activo?: boolean
          fecha_creacion?: string
        }
        Update: {
          id?: string
          nivel_id?: number
          denominacion?: string
          division?: string
          activo?: boolean
          fecha_creacion?: string
        }
      }
      actividades: {
        Row: {
          id: number
          nombre: string
          tipo: string | null
          cupo_maximo: number
          nivel_id: number | null
          activo: boolean
        }
        Insert: {
          id?: number
          nombre: string
          tipo?: string | null
          cupo_maximo?: number
          nivel_id?: number | null
          activo?: boolean
        }
        Update: {
          id?: number
          nombre?: string
          tipo?: string | null
          cupo_maximo?: number
          nivel_id?: number | null
          activo?: boolean
        }
      }
      materias_cursos: {
        Row: {
          id: string
          materia_id: number
          curso_id: string
          profesor_id: string | null
          activo: boolean
          fecha_creacion: string
          fecha_actualizacion: string
        }
        Insert: {
          id?: string
          materia_id: number
          curso_id: string
          profesor_id?: string | null
          activo?: boolean
          fecha_creacion?: string
          fecha_actualizacion?: string
        }
        Update: {
          id?: string
          materia_id?: number
          curso_id?: string
          profesor_id?: string | null
          activo?: boolean
          fecha_creacion?: string
          fecha_actualizacion?: string
        }
      }
      servicios_escolares: {
        Row: {
          id: string
          tipo: 'COMEDOR' | 'TRANSPORTE'
          codigo: string
          nombre: string
          activo: boolean
          fecha_creacion: string
          fecha_actualizacion: string
        }
        Insert: {
          id?: string
          tipo: 'COMEDOR' | 'TRANSPORTE'
          codigo: string
          nombre: string
          activo?: boolean
          fecha_creacion?: string
          fecha_actualizacion?: string
        }
        Update: {
          id?: string
          tipo?: 'COMEDOR' | 'TRANSPORTE'
          codigo?: string
          nombre?: string
          activo?: boolean
          fecha_creacion?: string
          fecha_actualizacion?: string
        }
      }
      inscripciones_servicios: {
        Row: {
          id: string
          alumno_id: string
          servicio_id: string
          estado: 'ACTIVA' | 'CANCELADA'
          fecha_inscripcion: string
          fecha_cancelacion: string | null
        }
        Insert: {
          id?: string
          alumno_id: string
          servicio_id: string
          estado?: 'ACTIVA' | 'CANCELADA'
          fecha_inscripcion?: string
          fecha_cancelacion?: string | null
        }
        Update: {
          id?: string
          alumno_id?: string
          servicio_id?: string
          estado?: 'ACTIVA' | 'CANCELADA'
          fecha_inscripcion?: string
          fecha_cancelacion?: string | null
        }
      }
      deportes: {
        Row: {
          id: string
          nombre: string
          activo: boolean
          fecha_creacion: string
          fecha_actualizacion: string
        }
        Insert: {
          id?: string
          nombre: string
          activo?: boolean
          fecha_creacion?: string
          fecha_actualizacion?: string
        }
        Update: {
          id?: string
          nombre?: string
          activo?: boolean
          fecha_creacion?: string
          fecha_actualizacion?: string
        }
      }
      grupos_deportivos: {
        Row: {
          id: string
          deporte_id: string
          nivel_id: number
          nombre: string
          cupo: number
          profesor_id: string
          activo: boolean
          fecha_creacion: string
          fecha_actualizacion: string
        }
        Insert: {
          id?: string
          deporte_id: string
          nivel_id: number
          nombre: string
          cupo: number
          profesor_id: string
          activo?: boolean
          fecha_creacion?: string
          fecha_actualizacion?: string
        }
        Update: {
          id?: string
          deporte_id?: string
          nivel_id?: number
          nombre?: string
          cupo?: number
          profesor_id?: string
          activo?: boolean
          fecha_creacion?: string
          fecha_actualizacion?: string
        }
      }
      horarios: {
        Row: {
          id: string
          // 1 = lunes … 7 = domingo.
          dia_semana: number
          hora_inicio: string
          hora_fin: string
          fecha_creacion: string
        }
        Insert: {
          id?: string
          dia_semana: number
          hora_inicio: string
          hora_fin: string
          fecha_creacion?: string
        }
        Update: {
          id?: string
          dia_semana?: number
          hora_inicio?: string
          hora_fin?: string
          fecha_creacion?: string
        }
      }
      grupos_deportivos_horarios: {
        Row: {
          id: string
          grupo_id: string
          horario_id: string
          activo: boolean
          fecha_alta: string
          fecha_baja: string | null
        }
        Insert: {
          id?: string
          grupo_id: string
          horario_id: string
          activo?: boolean
          fecha_alta?: string
          fecha_baja?: string | null
        }
        Update: {
          id?: string
          grupo_id?: string
          horario_id?: string
          activo?: boolean
          fecha_alta?: string
          fecha_baja?: string | null
        }
      }
      inscripciones_deportivas: {
        Row: {
          id: string
          alumno_id: string
          grupo_id: string
          deporte_id: string
          estado: 'ACTIVA' | 'CANCELADA'
          fecha_inscripcion: string
          fecha_cancelacion: string | null
        }
        Insert: {
          id?: string
          alumno_id: string
          grupo_id: string
          deporte_id?: string
          estado?: 'ACTIVA' | 'CANCELADA'
          fecha_inscripcion?: string
          fecha_cancelacion?: string | null
        }
        Update: {
          id?: string
          alumno_id?: string
          grupo_id?: string
          deporte_id?: string
          estado?: 'ACTIVA' | 'CANCELADA'
          fecha_inscripcion?: string
          fecha_cancelacion?: string | null
        }
      }
      inscripciones: {
        Row: {
          id: string
          estudiante_id: string | null
          actividad_id: number | null
          fecha_inscripcion: string
          estado: string
        }
        Insert: {
          id?: string
          estudiante_id?: string | null
          actividad_id?: number | null
          fecha_inscripcion?: string
          estado?: string
        }
        Update: {
          id?: string
          estudiante_id?: string | null
          actividad_id?: number | null
          fecha_inscripcion?: string
          estado?: string
        }
      }
      asistencias: {
        Row: {
          id: string
          estudiante_id: string | null
          fecha: string
          estado: 'PRESENTE' | 'AUSENTE' | 'JUSTIFICADO'
          docente_id: string | null
        }
        Insert: {
          id?: string
          estudiante_id?: string | null
          fecha?: string
          estado: 'PRESENTE' | 'AUSENTE' | 'JUSTIFICADO'
          docente_id?: string | null
        }
        Update: {
          id?: string
          estudiante_id?: string | null
          fecha?: string
          estado?: 'PRESENTE' | 'AUSENTE' | 'JUSTIFICADO'
          docente_id?: string | null
        }
      }
      solicitudes_inscripcion: {
        Row: {
          id: string
          datos_aspirante: Json
          estado: 'PENDIENTE' | 'REVISADO' | 'ACEPTADO'
          fecha_solicitud: string
        }
        Insert: {
          id?: string
          datos_aspirante: Json
          estado?: 'PENDIENTE' | 'REVISADO' | 'ACEPTADO'
          fecha_solicitud?: string
        }
        Update: {
          id?: string
          datos_aspirante?: Json
          estado?: 'PENDIENTE' | 'REVISADO' | 'ACEPTADO'
          fecha_solicitud?: string
        }
      }
      noticias: {
        Row: {
          id: number
          titulo: string
          contenido: string
          imagen_url: string | null
          fecha_publicacion: string
        }
        Insert: {
          id?: number
          titulo: string
          contenido: string
          imagen_url?: string | null
          fecha_publicacion?: string
        }
        Update: {
          id?: number
          titulo?: string
          contenido?: string
          imagen_url?: string | null
          fecha_publicacion?: string
        }
      }
      menu_escolar: {
        Row: {
          id: number
          dia_semana: string | null
          descripcion: string | null
          fecha_vigencia: string | null
        }
        Insert: {
          id?: number
          dia_semana?: string | null
          descripcion?: string | null
          fecha_vigencia?: string | null
        }
        Update: {
          id?: number
          dia_semana?: string | null
          descripcion?: string | null
          fecha_vigencia?: string | null
        }
      }
      opiniones: {
        Row: {
          id: number
          nombre_usuario: string
          comentario: string
          fecha: string
          aprobado: boolean
        }
        Insert: {
          id?: number
          nombre_usuario?: string
          comentario: string
          fecha?: string
          aprobado?: boolean
        }
        Update: {
          id?: number
          nombre_usuario?: string
          comentario?: string
          fecha?: string
          aprobado?: boolean
        }
      }
      galeria: {
        Row: {
          id: number
          url: string
          descripcion: string | null
          categoria: string | null
        }
        Insert: {
          id?: number
          url: string
          descripcion?: string | null
          categoria?: string | null
        }
        Update: {
          id?: number
          url?: string
          descripcion?: string | null
          categoria?: string | null
        }
      }
      postulaciones: {
        Row: {
          id: string
          nombre: string
          apellido: string
          email: string
          telefono: string
          puesto: string
          mensaje: string
          estado: 'PENDIENTE' | 'REVISADO' | 'CONTACTADO' | 'DESCARTADO'
          fecha_postulacion: string
        }
        Insert: {
          id?: string
          nombre: string
          apellido: string
          email: string
          telefono: string
          puesto: string
          mensaje: string
          estado?: 'PENDIENTE' | 'REVISADO' | 'CONTACTADO' | 'DESCARTADO'
          fecha_postulacion?: string
        }
        Update: {
          id?: string
          nombre?: string
          apellido?: string
          email?: string
          telefono?: string
          puesto?: string
          mensaje?: string
          estado?: 'PENDIENTE' | 'REVISADO' | 'CONTACTADO' | 'DESCARTADO'
          fecha_postulacion?: string
        }
      }
      padres_hijos: {
        Row: {
          padre_id: string
          hijo_id: string
          fecha_creacion: string
        }
        Insert: {
          padre_id: string
          hijo_id: string
          fecha_creacion?: string
        }
        Update: {
          padre_id?: string
          hijo_id?: string
          fecha_creacion?: string
        }
      }
    }
    Views: {
      inscripciones_servicios_detalle: {
        Row: {
          id: string | null
          alumno_id: string | null
          alumno_nombre: string | null
          alumno_apellido: string | null
          legajo_nro: string | null
          alumno_estado: 'ACTIVO' | 'INACTIVO' | null
          servicio_id: string | null
          servicio_tipo: 'COMEDOR' | 'TRANSPORTE' | null
          servicio_codigo: string | null
          servicio_nombre: string | null
          servicio_activo: boolean | null
          estado: 'ACTIVA' | 'CANCELADA' | null
          fecha_inscripcion: string | null
          fecha_cancelacion: string | null
        }
      }
      inscripciones_deportivas_detalle: {
        Row: {
          id: string | null
          alumno_id: string | null
          alumno_nombre: string | null
          alumno_apellido: string | null
          legajo_nro: string | null
          grupo_id: string | null
          grupo_nombre: string | null
          deporte_id: string | null
          deporte_nombre: string | null
          nivel_id: number | null
          nivel_nombre: string | null
          estado: 'ACTIVA' | 'CANCELADA' | null
          fecha_inscripcion: string | null
          fecha_cancelacion: string | null
        }
      }
      materias: {
        Row: {
          id: number | null
          nombre: string | null
          activo: boolean | null
        }
      }
      materias_cursos_detalle: {
        Row: {
          id: string | null
          materia_id: number | null
          materia_nombre: string | null
          materia_activa: boolean | null
          curso_id: string | null
          curso_denominacion: string | null
          curso_division: string | null
          curso_activo: boolean | null
          nivel_nombre: string | null
          profesor_id: string | null
          profesor_nombre: string | null
          profesor_apellido: string | null
          activo: boolean | null
          fecha_creacion: string | null
          fecha_actualizacion: string | null
        }
      }
    }
    Functions: {
      asignar_materia_curso: {
        Args: { p_curso_id: string; p_materia_id: number; p_profesor_id?: string | null }
        Returns: Database['public']['Tables']['materias_cursos']['Row']
      }
      calcular_porcentaje_asistencia: {
        Args: { p_estudiante_id: string }
        Returns: number
      }
      cambiar_estado_asignacion: {
        Args: { p_activo: boolean; p_asignacion_id: string }
        Returns: Database['public']['Tables']['materias_cursos']['Row']
      }
      cambiar_estado_materia: {
        Args: { p_activo: boolean; p_materia_id: number }
        Returns: Database['public']['Views']['materias']['Row']
      }
      cambiar_profesor_asignacion: {
        Args: { p_asignacion_id: string; p_profesor_id: string | null }
        Returns: Database['public']['Tables']['materias_cursos']['Row']
      }
      crear_materia: {
        Args: { p_nombre: string }
        Returns: Database['public']['Views']['materias']['Row']
      }
      renombrar_materia: {
        Args: { p_materia_id: number; p_nombre: string }
        Returns: Database['public']['Views']['materias']['Row']
      }
      cambiar_estado_nivel: {
        Args: { p_activo: boolean; p_nivel_id: number }
        Returns: {
          activo: boolean
          es_institucional: boolean
          id: number
          nombre: string
          orden: number
        }
      }
      crear_nivel: {
        Args: { p_nombre: string }
        Returns: {
          activo: boolean
          es_institucional: boolean
          id: number
          nombre: string
          orden: number
        }
      }
      es_director_actual: {
        Args: Record<string, never>
        Returns: boolean
      }
      rol_actual: {
        Args: Record<string, never>
        // `null` cuando la sesión autenticada no tiene perfil.
        Returns: string | null
      }
      matricular_hijo: {
        Args: { p_hijo_id: string; p_curso_id: string }
        Returns: string
      }
      consultar_detalle_hijo: {
        Args: { p_hijo_id: string }
        Returns: Json
      }
      inscribir_en_servicio: {
        Args: { p_servicio_id: string }
        Returns: Database['public']['Tables']['inscripciones_servicios']['Row']
      }
      cancelar_inscripcion_servicio: {
        Args: { p_inscripcion_id: string }
        Returns: Database['public']['Tables']['inscripciones_servicios']['Row']
      }
      listar_grupos_deportivos: {
        Args: Record<string, never>
        Returns: {
          grupo_id: string
          grupo_nombre: string
          deporte_id: string
          deporte_nombre: string
          deporte_activo: boolean
          nivel_id: number
          nivel_nombre: string
          // `null` para el estudiante: no recibe el identificador del profesor.
          profesor_id: string | null
          profesor_nombre: string
          profesor_apellido: string
          cupo: number
          ocupados: number
          disponibles: number
          activo: boolean
          // `null` cuando el estudiante no está inscripto en el grupo.
          inscripcion_propia_id: string | null
        }[]
      }
      crear_grupo_deportivo: {
        Args: {
          p_deporte_id: string
          p_nivel_id: number
          p_nombre: string
          p_cupo: number
          p_profesor_id: string
        }
        Returns: Database['public']['Tables']['grupos_deportivos']['Row']
      }
      inscribir_en_grupo_deportivo: {
        Args: { p_grupo_id: string }
        Returns: Database['public']['Tables']['inscripciones_deportivas']['Row']
      }
      cancelar_inscripcion_deportiva: {
        Args: { p_inscripcion_id: string }
        Returns: Database['public']['Tables']['inscripciones_deportivas']['Row']
      }
      agregar_horario_grupo_deportivo: {
        Args: {
          p_grupo_id: string
          p_dia_semana: number
          p_hora_inicio: string
          p_hora_fin: string
        }
        Returns: Database['public']['Tables']['grupos_deportivos_horarios']['Row']
      }
      dar_de_baja_horario_grupo_deportivo: {
        Args: { p_grupo_id: string; p_franja_id: string }
        Returns: Database['public']['Tables']['grupos_deportivos_horarios']['Row']
      }
      inscribir_alumno_en_grupo_deportivo: {
        Args: { p_alumno_id: string; p_grupo_id: string }
        Returns: Database['public']['Tables']['inscripciones_deportivas']['Row']
      }
      consultar_compatibilidad_horaria: {
        Args: Record<string, never>
        Returns: CompatibilidadHorariaFila[]
      }
      consultar_compatibilidad_horaria_alumno: {
        Args: { p_alumno_id: string }
        Returns: CompatibilidadHorariaFila[]
      }
      renombrar_nivel: {
        Args: { p_nivel_id: number; p_nombre: string }
        Returns: {
          activo: boolean
          es_institucional: boolean
          id: number
          nombre: string
          orden: number
        }
      }
    }
  }
}

/** Fila de las consultas de compatibilidad horaria (EPT-12). */
type CompatibilidadHorariaFila = {
  grupo_id: string
  tiene_horario: boolean
  // Todas `null` cuando el grupo no choca con ninguna actividad activa.
  conflicto_deporte: string | null
  conflicto_grupo: string | null
  conflicto_dia_semana: number | null
  conflicto_hora_inicio: string | null
  conflicto_hora_fin: string | null
}

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

export type Perfil = Tables<'perfiles'>
export type Asistencia = Tables<'asistencias'>
export type Actividad = Tables<'actividades'>
export type Inscripcion = Tables<'inscripciones'>
export type Noticia = Tables<'noticias'>
export type Solicitud = Tables<'solicitudes_inscripcion'>
export type Galeria = Tables<'galeria'>
export type Rol = Tables<'roles'>
export type Nivel = Tables<'niveles'>
export type Curso = Tables<'cursos'>
export type Postulacion = Tables<'postulaciones'>
export type MateriaCurso = Tables<'materias_cursos'>
export type ServicioEscolarFila = Tables<'servicios_escolares'>
export type InscripcionServicioFila = Tables<'inscripciones_servicios'>
export type DeporteFila = Tables<'deportes'>
export type GrupoDeportivoFila = Tables<'grupos_deportivos'>
export type InscripcionDeportivaFila = Tables<'inscripciones_deportivas'>
export type HorarioFila = Tables<'horarios'>
export type FranjaGrupoDeportivoFila = Tables<'grupos_deportivos_horarios'>
