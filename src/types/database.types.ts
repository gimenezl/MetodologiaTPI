/**
 * Tipos de base de datos escritos a mano.
 *
 * ESTE ARCHIVO NO ES GENERADO. `database.generated.ts`, en esta misma carpeta,
 * sí lo es: sale de `supabase gen types typescript --local` contra una base
 * reconstruida desde cero con la cadena completa de migraciones. Se conserva
 * como artefacto de referencia para poder comparar.
 *
 * Diferencias verificadas entre este archivo y el esquema real (EPT-8):
 *
 * - `cursos` y la función `es_director_actual` coinciden exactamente con el
 *   esquema generado.
 * - `padres_hijos` existe solo acá. No hay ninguna migración que lo cree, pero
 *   `usuarios.service.ts` y `api/usuarios/route.ts` lo usan.
 * - `opiniones.aprobado` existe solo acá. Tampoco hay migración que lo cree, y
 *   `noticias.service.ts` lo usa.
 *
 * Esas dos últimas son deriva preexistente entre las migraciones y la base que
 * la aplicación asume. No se borran acá a propósito: quitarlas rompería la
 * compilación y escondería el problema. Corresponde a EPT-66 decidir si la
 * deriva se documenta en migraciones nuevas o si el código se corrige.
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
        }
        Insert: {
          id?: number
          nombre: string
          tipo?: string | null
          cupo_maximo?: number
          nivel_id?: number | null
        }
        Update: {
          id?: number
          nombre?: string
          tipo?: string | null
          cupo_maximo?: number
          nivel_id?: number | null
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
    Functions: {
      calcular_porcentaje_asistencia: {
        Args: { p_estudiante_id: string }
        Returns: number
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
