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
        Row: { id: number; nombre: string }
        Insert: { id?: number; nombre: string }
        Update: { id?: number; nombre?: string }
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
export type Postulacion = Tables<'postulaciones'>
