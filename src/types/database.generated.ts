export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      actividades: {
        Row: {
          activo: boolean
          cupo_maximo: number | null
          id: number
          nivel_id: number | null
          nombre: string
          tipo: string | null
        }
        Insert: {
          activo?: boolean
          cupo_maximo?: number | null
          id?: number
          nivel_id?: number | null
          nombre: string
          tipo?: string | null
        }
        Update: {
          activo?: boolean
          cupo_maximo?: number | null
          id?: number
          nivel_id?: number | null
          nombre?: string
          tipo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "actividades_nivel_id_fkey"
            columns: ["nivel_id"]
            isOneToOne: false
            referencedRelation: "alumnos_academicos"
            referencedColumns: ["nivel_id"]
          },
          {
            foreignKeyName: "actividades_nivel_id_fkey"
            columns: ["nivel_id"]
            isOneToOne: false
            referencedRelation: "matriculas_historial"
            referencedColumns: ["nivel_id"]
          },
          {
            foreignKeyName: "actividades_nivel_id_fkey"
            columns: ["nivel_id"]
            isOneToOne: false
            referencedRelation: "niveles"
            referencedColumns: ["id"]
          },
        ]
      }
      alumnos: {
        Row: {
          estado: Database["public"]["Enums"]["estado_alumno"]
          fecha_actualizacion: string
          fecha_alta: string
          perfil_id: string
        }
        Insert: {
          estado: Database["public"]["Enums"]["estado_alumno"]
          fecha_actualizacion?: string
          fecha_alta?: string
          perfil_id: string
        }
        Update: {
          estado?: Database["public"]["Enums"]["estado_alumno"]
          fecha_actualizacion?: string
          fecha_alta?: string
          perfil_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alumnos_perfil_id_fkey"
            columns: ["perfil_id"]
            isOneToOne: true
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      asistencias: {
        Row: {
          docente_id: string | null
          estado: string
          estudiante_id: string | null
          fecha: string | null
          id: string
        }
        Insert: {
          docente_id?: string | null
          estado: string
          estudiante_id?: string | null
          fecha?: string | null
          id?: string
        }
        Update: {
          docente_id?: string | null
          estado?: string
          estudiante_id?: string | null
          fecha?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asistencias_docente_id_fkey"
            columns: ["docente_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asistencias_estudiante_id_fkey"
            columns: ["estudiante_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cursos: {
        Row: {
          activo: boolean
          denominacion: string
          division: string
          fecha_creacion: string
          id: string
          nivel_id: number
        }
        Insert: {
          activo?: boolean
          denominacion: string
          division: string
          fecha_creacion?: string
          id?: string
          nivel_id: number
        }
        Update: {
          activo?: boolean
          denominacion?: string
          division?: string
          fecha_creacion?: string
          id?: string
          nivel_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "cursos_nivel_id_fkey"
            columns: ["nivel_id"]
            isOneToOne: false
            referencedRelation: "alumnos_academicos"
            referencedColumns: ["nivel_id"]
          },
          {
            foreignKeyName: "cursos_nivel_id_fkey"
            columns: ["nivel_id"]
            isOneToOne: false
            referencedRelation: "matriculas_historial"
            referencedColumns: ["nivel_id"]
          },
          {
            foreignKeyName: "cursos_nivel_id_fkey"
            columns: ["nivel_id"]
            isOneToOne: false
            referencedRelation: "niveles"
            referencedColumns: ["id"]
          },
        ]
      }
      deportes: {
        Row: {
          activo: boolean
          fecha_actualizacion: string
          fecha_creacion: string
          id: string
          nombre: string
        }
        Insert: {
          activo?: boolean
          fecha_actualizacion?: string
          fecha_creacion?: string
          id?: string
          nombre: string
        }
        Update: {
          activo?: boolean
          fecha_actualizacion?: string
          fecha_creacion?: string
          id?: string
          nombre?: string
        }
        Relationships: []
      }
      galeria: {
        Row: {
          categoria: string | null
          descripcion: string | null
          id: number
          url: string
        }
        Insert: {
          categoria?: string | null
          descripcion?: string | null
          id?: number
          url: string
        }
        Update: {
          categoria?: string | null
          descripcion?: string | null
          id?: number
          url?: string
        }
        Relationships: []
      }
      grupos_deportivos: {
        Row: {
          activo: boolean
          cupo: number
          deporte_id: string
          fecha_actualizacion: string
          fecha_creacion: string
          id: string
          nivel_id: number
          nombre: string
          profesor_id: string
        }
        Insert: {
          activo?: boolean
          cupo: number
          deporte_id: string
          fecha_actualizacion?: string
          fecha_creacion?: string
          id?: string
          nivel_id: number
          nombre: string
          profesor_id: string
        }
        Update: {
          activo?: boolean
          cupo?: number
          deporte_id?: string
          fecha_actualizacion?: string
          fecha_creacion?: string
          id?: string
          nivel_id?: number
          nombre?: string
          profesor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grupos_deportivos_deporte_id_fkey"
            columns: ["deporte_id"]
            isOneToOne: false
            referencedRelation: "deportes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grupos_deportivos_nivel_id_fkey"
            columns: ["nivel_id"]
            isOneToOne: false
            referencedRelation: "alumnos_academicos"
            referencedColumns: ["nivel_id"]
          },
          {
            foreignKeyName: "grupos_deportivos_nivel_id_fkey"
            columns: ["nivel_id"]
            isOneToOne: false
            referencedRelation: "matriculas_historial"
            referencedColumns: ["nivel_id"]
          },
          {
            foreignKeyName: "grupos_deportivos_nivel_id_fkey"
            columns: ["nivel_id"]
            isOneToOne: false
            referencedRelation: "niveles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grupos_deportivos_profesor_id_fkey"
            columns: ["profesor_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      grupos_deportivos_horarios: {
        Row: {
          activo: boolean
          fecha_alta: string
          fecha_baja: string | null
          grupo_id: string
          horario_id: string
          id: string
        }
        Insert: {
          activo?: boolean
          fecha_alta?: string
          fecha_baja?: string | null
          grupo_id: string
          horario_id: string
          id?: string
        }
        Update: {
          activo?: boolean
          fecha_alta?: string
          fecha_baja?: string | null
          grupo_id?: string
          horario_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grupos_deportivos_horarios_grupo_id_fkey"
            columns: ["grupo_id"]
            isOneToOne: false
            referencedRelation: "grupos_deportivos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grupos_deportivos_horarios_horario_id_fkey"
            columns: ["horario_id"]
            isOneToOne: false
            referencedRelation: "horarios"
            referencedColumns: ["id"]
          },
        ]
      }
      horarios: {
        Row: {
          dia_semana: number
          fecha_creacion: string
          hora_fin: string
          hora_inicio: string
          id: string
        }
        Insert: {
          dia_semana: number
          fecha_creacion?: string
          hora_fin: string
          hora_inicio: string
          id?: string
        }
        Update: {
          dia_semana?: number
          fecha_creacion?: string
          hora_fin?: string
          hora_inicio?: string
          id?: string
        }
        Relationships: []
      }
      inscripciones: {
        Row: {
          actividad_id: number | null
          estado: string | null
          estudiante_id: string | null
          fecha_inscripcion: string | null
          id: string
        }
        Insert: {
          actividad_id?: number | null
          estado?: string | null
          estudiante_id?: string | null
          fecha_inscripcion?: string | null
          id?: string
        }
        Update: {
          actividad_id?: number | null
          estado?: string | null
          estudiante_id?: string | null
          fecha_inscripcion?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inscripciones_actividad_id_fkey"
            columns: ["actividad_id"]
            isOneToOne: false
            referencedRelation: "actividades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inscripciones_actividad_id_fkey"
            columns: ["actividad_id"]
            isOneToOne: false
            referencedRelation: "materias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inscripciones_estudiante_id_fkey"
            columns: ["estudiante_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inscripciones_deportivas: {
        Row: {
          alumno_id: string
          deporte_id: string
          estado: Database["public"]["Enums"]["estado_inscripcion_deportiva"]
          fecha_cancelacion: string | null
          fecha_inscripcion: string
          grupo_id: string
          id: string
        }
        Insert: {
          alumno_id: string
          deporte_id: string
          estado?: Database["public"]["Enums"]["estado_inscripcion_deportiva"]
          fecha_cancelacion?: string | null
          fecha_inscripcion?: string
          grupo_id: string
          id?: string
        }
        Update: {
          alumno_id?: string
          deporte_id?: string
          estado?: Database["public"]["Enums"]["estado_inscripcion_deportiva"]
          fecha_cancelacion?: string | null
          fecha_inscripcion?: string
          grupo_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inscripciones_deportivas_alumno_id_fkey"
            columns: ["alumno_id"]
            isOneToOne: false
            referencedRelation: "alumnos"
            referencedColumns: ["perfil_id"]
          },
          {
            foreignKeyName: "inscripciones_deportivas_alumno_id_fkey"
            columns: ["alumno_id"]
            isOneToOne: false
            referencedRelation: "alumnos_academicos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inscripciones_deportivas_deporte_id_fkey"
            columns: ["deporte_id"]
            isOneToOne: false
            referencedRelation: "deportes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inscripciones_deportivas_grupo_deporte_fk"
            columns: ["grupo_id", "deporte_id"]
            isOneToOne: false
            referencedRelation: "grupos_deportivos"
            referencedColumns: ["id", "deporte_id"]
          },
        ]
      }
      inscripciones_servicios: {
        Row: {
          alumno_id: string
          estado: Database["public"]["Enums"]["estado_inscripcion_servicio"]
          fecha_cancelacion: string | null
          fecha_inscripcion: string
          id: string
          servicio_id: string
        }
        Insert: {
          alumno_id: string
          estado?: Database["public"]["Enums"]["estado_inscripcion_servicio"]
          fecha_cancelacion?: string | null
          fecha_inscripcion?: string
          id?: string
          servicio_id: string
        }
        Update: {
          alumno_id?: string
          estado?: Database["public"]["Enums"]["estado_inscripcion_servicio"]
          fecha_cancelacion?: string | null
          fecha_inscripcion?: string
          id?: string
          servicio_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inscripciones_servicios_alumno_id_fkey"
            columns: ["alumno_id"]
            isOneToOne: false
            referencedRelation: "alumnos"
            referencedColumns: ["perfil_id"]
          },
          {
            foreignKeyName: "inscripciones_servicios_alumno_id_fkey"
            columns: ["alumno_id"]
            isOneToOne: false
            referencedRelation: "alumnos_academicos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inscripciones_servicios_servicio_id_fkey"
            columns: ["servicio_id"]
            isOneToOne: false
            referencedRelation: "servicios_escolares"
            referencedColumns: ["id"]
          },
        ]
      }
      materias_cursos: {
        Row: {
          activo: boolean
          curso_id: string
          fecha_actualizacion: string
          fecha_creacion: string
          id: string
          materia_id: number
          profesor_id: string | null
        }
        Insert: {
          activo?: boolean
          curso_id: string
          fecha_actualizacion?: string
          fecha_creacion?: string
          id?: string
          materia_id: number
          profesor_id?: string | null
        }
        Update: {
          activo?: boolean
          curso_id?: string
          fecha_actualizacion?: string
          fecha_creacion?: string
          id?: string
          materia_id?: number
          profesor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "materias_cursos_curso_id_fkey"
            columns: ["curso_id"]
            isOneToOne: false
            referencedRelation: "alumnos_academicos"
            referencedColumns: ["curso_id"]
          },
          {
            foreignKeyName: "materias_cursos_curso_id_fkey"
            columns: ["curso_id"]
            isOneToOne: false
            referencedRelation: "cursos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materias_cursos_curso_id_fkey"
            columns: ["curso_id"]
            isOneToOne: false
            referencedRelation: "matriculas_historial"
            referencedColumns: ["curso_id"]
          },
          {
            foreignKeyName: "materias_cursos_materia_id_fkey"
            columns: ["materia_id"]
            isOneToOne: false
            referencedRelation: "actividades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materias_cursos_materia_id_fkey"
            columns: ["materia_id"]
            isOneToOne: false
            referencedRelation: "materias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materias_cursos_profesor_id_fkey"
            columns: ["profesor_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      materias_cursos_horarios: {
        Row: {
          activo: boolean
          asignacion_id: string
          fecha_alta: string
          fecha_baja: string | null
          horario_id: string
          id: string
        }
        Insert: {
          activo?: boolean
          asignacion_id: string
          fecha_alta?: string
          fecha_baja?: string | null
          horario_id: string
          id?: string
        }
        Update: {
          activo?: boolean
          asignacion_id?: string
          fecha_alta?: string
          fecha_baja?: string | null
          horario_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "materias_cursos_horarios_asignacion_id_fkey"
            columns: ["asignacion_id"]
            isOneToOne: false
            referencedRelation: "materias_cursos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materias_cursos_horarios_asignacion_id_fkey"
            columns: ["asignacion_id"]
            isOneToOne: false
            referencedRelation: "materias_cursos_detalle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materias_cursos_horarios_horario_id_fkey"
            columns: ["horario_id"]
            isOneToOne: false
            referencedRelation: "horarios"
            referencedColumns: ["id"]
          },
        ]
      }
      materias_cursos_horarios_historial: {
        Row: {
          activo_anterior: boolean
          activo_nuevo: boolean
          asignacion_anterior: string
          asignacion_nueva: string
          cambiado_en: string
          fecha_baja_anterior: string | null
          franja_id: string
          horario_anterior: string
          horario_nuevo: string
          id: number
        }
        Insert: {
          activo_anterior: boolean
          activo_nuevo: boolean
          asignacion_anterior: string
          asignacion_nueva: string
          cambiado_en?: string
          fecha_baja_anterior?: string | null
          franja_id: string
          horario_anterior: string
          horario_nuevo: string
          id?: never
        }
        Update: {
          activo_anterior?: boolean
          activo_nuevo?: boolean
          asignacion_anterior?: string
          asignacion_nueva?: string
          cambiado_en?: string
          fecha_baja_anterior?: string | null
          franja_id?: string
          horario_anterior?: string
          horario_nuevo?: string
          id?: never
        }
        Relationships: [
          {
            foreignKeyName: "materias_cursos_horarios_historial_franja_id_fkey"
            columns: ["franja_id"]
            isOneToOne: false
            referencedRelation: "materias_cursos_horarios"
            referencedColumns: ["id"]
          },
        ]
      }
      matriculas: {
        Row: {
          alumno_id: string
          curso_id: string
          fecha_cierre: string | null
          fecha_inicio: string
          id: string
          motivo_cierre:
            | Database["public"]["Enums"]["motivo_cierre_matricula"]
            | null
        }
        Insert: {
          alumno_id: string
          curso_id: string
          fecha_cierre?: string | null
          fecha_inicio?: string
          id?: string
          motivo_cierre?:
            | Database["public"]["Enums"]["motivo_cierre_matricula"]
            | null
        }
        Update: {
          alumno_id?: string
          curso_id?: string
          fecha_cierre?: string | null
          fecha_inicio?: string
          id?: string
          motivo_cierre?:
            | Database["public"]["Enums"]["motivo_cierre_matricula"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "matriculas_alumno_id_fkey"
            columns: ["alumno_id"]
            isOneToOne: false
            referencedRelation: "alumnos"
            referencedColumns: ["perfil_id"]
          },
          {
            foreignKeyName: "matriculas_alumno_id_fkey"
            columns: ["alumno_id"]
            isOneToOne: false
            referencedRelation: "alumnos_academicos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matriculas_curso_id_fkey"
            columns: ["curso_id"]
            isOneToOne: false
            referencedRelation: "alumnos_academicos"
            referencedColumns: ["curso_id"]
          },
          {
            foreignKeyName: "matriculas_curso_id_fkey"
            columns: ["curso_id"]
            isOneToOne: false
            referencedRelation: "cursos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matriculas_curso_id_fkey"
            columns: ["curso_id"]
            isOneToOne: false
            referencedRelation: "matriculas_historial"
            referencedColumns: ["curso_id"]
          },
        ]
      }
      menu_escolar: {
        Row: {
          descripcion: string | null
          dia_semana: string | null
          fecha_vigencia: string | null
          id: number
        }
        Insert: {
          descripcion?: string | null
          dia_semana?: string | null
          fecha_vigencia?: string | null
          id?: number
        }
        Update: {
          descripcion?: string | null
          dia_semana?: string | null
          fecha_vigencia?: string | null
          id?: number
        }
        Relationships: []
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
        Relationships: []
      }
      noticias: {
        Row: {
          contenido: string
          fecha_publicacion: string | null
          id: number
          imagen_url: string | null
          titulo: string
        }
        Insert: {
          contenido: string
          fecha_publicacion?: string | null
          id?: number
          imagen_url?: string | null
          titulo: string
        }
        Update: {
          contenido?: string
          fecha_publicacion?: string | null
          id?: number
          imagen_url?: string | null
          titulo?: string
        }
        Relationships: []
      }
      opiniones: {
        Row: {
          aprobado: boolean
          comentario: string
          fecha: string | null
          id: number
          nombre_usuario: string | null
        }
        Insert: {
          aprobado?: boolean
          comentario: string
          fecha?: string | null
          id?: number
          nombre_usuario?: string | null
        }
        Update: {
          aprobado?: boolean
          comentario?: string
          fecha?: string | null
          id?: number
          nombre_usuario?: string | null
        }
        Relationships: []
      }
      padres_hijos: {
        Row: {
          fecha_creacion: string
          hijo_id: string
          padre_id: string
        }
        Insert: {
          fecha_creacion?: string
          hijo_id: string
          padre_id: string
        }
        Update: {
          fecha_creacion?: string
          hijo_id?: string
          padre_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "padres_hijos_hijo_id_fkey"
            columns: ["hijo_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "padres_hijos_padre_id_fkey"
            columns: ["padre_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      perfiles: {
        Row: {
          apellido: string
          direccion: string | null
          dni: string
          fecha_creacion: string | null
          fecha_nacimiento: string | null
          id: string
          legajo_nro: string | null
          nombre: string
          rol_id: number | null
          telefono: string | null
          user_id: string | null
        }
        Insert: {
          apellido: string
          direccion?: string | null
          dni: string
          fecha_creacion?: string | null
          fecha_nacimiento?: string | null
          id?: string
          legajo_nro?: string | null
          nombre: string
          rol_id?: number | null
          telefono?: string | null
          user_id?: string | null
        }
        Update: {
          apellido?: string
          direccion?: string | null
          dni?: string
          fecha_creacion?: string | null
          fecha_nacimiento?: string | null
          id?: string
          legajo_nro?: string | null
          nombre?: string
          rol_id?: number | null
          telefono?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "perfiles_rol_id_fkey"
            columns: ["rol_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      postulaciones: {
        Row: {
          apellido: string
          email: string
          estado: string | null
          fecha_postulacion: string | null
          id: string
          mensaje: string
          nombre: string
          puesto: string
          telefono: string
        }
        Insert: {
          apellido: string
          email: string
          estado?: string | null
          fecha_postulacion?: string | null
          id?: string
          mensaje: string
          nombre: string
          puesto: string
          telefono: string
        }
        Update: {
          apellido?: string
          email?: string
          estado?: string | null
          fecha_postulacion?: string | null
          id?: string
          mensaje?: string
          nombre?: string
          puesto?: string
          telefono?: string
        }
        Relationships: []
      }
      roles: {
        Row: {
          id: number
          nombre: string
        }
        Insert: {
          id?: number
          nombre: string
        }
        Update: {
          id?: number
          nombre?: string
        }
        Relationships: []
      }
      servicios_escolares: {
        Row: {
          activo: boolean
          codigo: string
          fecha_actualizacion: string
          fecha_creacion: string
          id: string
          nombre: string
          tipo: Database["public"]["Enums"]["tipo_servicio_escolar"]
        }
        Insert: {
          activo?: boolean
          codigo: string
          fecha_actualizacion?: string
          fecha_creacion?: string
          id?: string
          nombre: string
          tipo: Database["public"]["Enums"]["tipo_servicio_escolar"]
        }
        Update: {
          activo?: boolean
          codigo?: string
          fecha_actualizacion?: string
          fecha_creacion?: string
          id?: string
          nombre?: string
          tipo?: Database["public"]["Enums"]["tipo_servicio_escolar"]
        }
        Relationships: []
      }
      solicitudes_inscripcion: {
        Row: {
          datos_aspirante: Json
          estado: string | null
          fecha_solicitud: string | null
          id: string
        }
        Insert: {
          datos_aspirante: Json
          estado?: string | null
          fecha_solicitud?: string | null
          id?: string
        }
        Update: {
          datos_aspirante?: Json
          estado?: string | null
          fecha_solicitud?: string | null
          id?: string
        }
        Relationships: []
      }
    }
    Views: {
      alumnos_academicos: {
        Row: {
          apellido: string | null
          curso_activo: boolean | null
          curso_denominacion: string | null
          curso_division: string | null
          curso_id: string | null
          direccion: string | null
          dni: string | null
          estado: Database["public"]["Enums"]["estado_alumno"] | null
          fecha_actualizacion: string | null
          fecha_nacimiento: string | null
          id: string | null
          legajo_nro: string | null
          matricula_desde: string | null
          matricula_id: string | null
          nivel_id: number | null
          nivel_nombre: string | null
          nombre: string | null
          telefono: string | null
          tiene_cuenta: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "alumnos_perfil_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inscripciones_deportivas_detalle: {
        Row: {
          alumno_apellido: string | null
          alumno_id: string | null
          alumno_nombre: string | null
          deporte_id: string | null
          deporte_nombre: string | null
          estado:
            | Database["public"]["Enums"]["estado_inscripcion_deportiva"]
            | null
          fecha_cancelacion: string | null
          fecha_inscripcion: string | null
          grupo_id: string | null
          grupo_nombre: string | null
          id: string | null
          legajo_nro: string | null
          nivel_id: number | null
          nivel_nombre: string | null
        }
        Relationships: [
          {
            foreignKeyName: "grupos_deportivos_nivel_id_fkey"
            columns: ["nivel_id"]
            isOneToOne: false
            referencedRelation: "alumnos_academicos"
            referencedColumns: ["nivel_id"]
          },
          {
            foreignKeyName: "grupos_deportivos_nivel_id_fkey"
            columns: ["nivel_id"]
            isOneToOne: false
            referencedRelation: "matriculas_historial"
            referencedColumns: ["nivel_id"]
          },
          {
            foreignKeyName: "grupos_deportivos_nivel_id_fkey"
            columns: ["nivel_id"]
            isOneToOne: false
            referencedRelation: "niveles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inscripciones_deportivas_alumno_id_fkey"
            columns: ["alumno_id"]
            isOneToOne: false
            referencedRelation: "alumnos"
            referencedColumns: ["perfil_id"]
          },
          {
            foreignKeyName: "inscripciones_deportivas_alumno_id_fkey"
            columns: ["alumno_id"]
            isOneToOne: false
            referencedRelation: "alumnos_academicos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inscripciones_deportivas_deporte_id_fkey"
            columns: ["deporte_id"]
            isOneToOne: false
            referencedRelation: "deportes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inscripciones_deportivas_grupo_deporte_fk"
            columns: ["grupo_id", "deporte_id"]
            isOneToOne: false
            referencedRelation: "grupos_deportivos"
            referencedColumns: ["id", "deporte_id"]
          },
        ]
      }
      inscripciones_servicios_detalle: {
        Row: {
          alumno_apellido: string | null
          alumno_estado: Database["public"]["Enums"]["estado_alumno"] | null
          alumno_id: string | null
          alumno_nombre: string | null
          estado:
            | Database["public"]["Enums"]["estado_inscripcion_servicio"]
            | null
          fecha_cancelacion: string | null
          fecha_inscripcion: string | null
          id: string | null
          legajo_nro: string | null
          servicio_activo: boolean | null
          servicio_codigo: string | null
          servicio_id: string | null
          servicio_nombre: string | null
          servicio_tipo:
            | Database["public"]["Enums"]["tipo_servicio_escolar"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "inscripciones_servicios_alumno_id_fkey"
            columns: ["alumno_id"]
            isOneToOne: false
            referencedRelation: "alumnos"
            referencedColumns: ["perfil_id"]
          },
          {
            foreignKeyName: "inscripciones_servicios_alumno_id_fkey"
            columns: ["alumno_id"]
            isOneToOne: false
            referencedRelation: "alumnos_academicos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inscripciones_servicios_servicio_id_fkey"
            columns: ["servicio_id"]
            isOneToOne: false
            referencedRelation: "servicios_escolares"
            referencedColumns: ["id"]
          },
        ]
      }
      materias: {
        Row: {
          activo: boolean | null
          id: number | null
          nombre: string | null
        }
        Insert: {
          activo?: boolean | null
          id?: number | null
          nombre?: string | null
        }
        Update: {
          activo?: boolean | null
          id?: number | null
          nombre?: string | null
        }
        Relationships: []
      }
      materias_cursos_detalle: {
        Row: {
          activo: boolean | null
          curso_activo: boolean | null
          curso_denominacion: string | null
          curso_division: string | null
          curso_id: string | null
          fecha_actualizacion: string | null
          fecha_creacion: string | null
          id: string | null
          materia_activa: boolean | null
          materia_id: number | null
          materia_nombre: string | null
          nivel_nombre: string | null
          profesor_apellido: string | null
          profesor_id: string | null
          profesor_nombre: string | null
        }
        Relationships: [
          {
            foreignKeyName: "materias_cursos_curso_id_fkey"
            columns: ["curso_id"]
            isOneToOne: false
            referencedRelation: "alumnos_academicos"
            referencedColumns: ["curso_id"]
          },
          {
            foreignKeyName: "materias_cursos_curso_id_fkey"
            columns: ["curso_id"]
            isOneToOne: false
            referencedRelation: "cursos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materias_cursos_curso_id_fkey"
            columns: ["curso_id"]
            isOneToOne: false
            referencedRelation: "matriculas_historial"
            referencedColumns: ["curso_id"]
          },
          {
            foreignKeyName: "materias_cursos_materia_id_fkey"
            columns: ["materia_id"]
            isOneToOne: false
            referencedRelation: "actividades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materias_cursos_materia_id_fkey"
            columns: ["materia_id"]
            isOneToOne: false
            referencedRelation: "materias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materias_cursos_profesor_id_fkey"
            columns: ["profesor_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      matriculas_historial: {
        Row: {
          alumno_id: string | null
          curso_activo: boolean | null
          curso_denominacion: string | null
          curso_division: string | null
          curso_id: string | null
          fecha_cierre: string | null
          fecha_inicio: string | null
          id: string | null
          motivo_cierre:
            | Database["public"]["Enums"]["motivo_cierre_matricula"]
            | null
          nivel_id: number | null
          nivel_nombre: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matriculas_alumno_id_fkey"
            columns: ["alumno_id"]
            isOneToOne: false
            referencedRelation: "alumnos"
            referencedColumns: ["perfil_id"]
          },
          {
            foreignKeyName: "matriculas_alumno_id_fkey"
            columns: ["alumno_id"]
            isOneToOne: false
            referencedRelation: "alumnos_academicos"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      agregar_horario_grupo_deportivo: {
        Args: {
          p_dia_semana: number
          p_grupo_id: string
          p_hora_fin: string
          p_hora_inicio: string
        }
        Returns: {
          activo: boolean
          fecha_alta: string
          fecha_baja: string | null
          grupo_id: string
          horario_id: string
          id: string
        }
        SetofOptions: {
          from: "*"
          to: "grupos_deportivos_horarios"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      asignar_materia_curso: {
        Args: {
          p_curso_id: string
          p_materia_id: number
          p_profesor_id?: string
        }
        Returns: {
          activo: boolean
          curso_id: string
          fecha_actualizacion: string
          fecha_creacion: string
          id: string
          materia_id: number
          profesor_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "materias_cursos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      calcular_porcentaje_asistencia: {
        Args: { p_estudiante_id: string }
        Returns: number
      }
      cambiar_curso_alumno: {
        Args: { p_alumno_id: string; p_curso_id: string }
        Returns: string
      }
      cambiar_estado_asignacion: {
        Args: { p_activo: boolean; p_asignacion_id: string }
        Returns: {
          activo: boolean
          curso_id: string
          fecha_actualizacion: string
          fecha_creacion: string
          id: string
          materia_id: number
          profesor_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "materias_cursos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cambiar_estado_horario_materia: {
        Args: { p_activo: boolean; p_franja_id: string }
        Returns: {
          activo: boolean
          asignacion_id: string
          fecha_alta: string
          fecha_baja: string | null
          horario_id: string
          id: string
        }
        SetofOptions: {
          from: "*"
          to: "materias_cursos_horarios"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cambiar_estado_materia: {
        Args: { p_activo: boolean; p_materia_id: number }
        Returns: {
          activo: boolean | null
          id: number | null
          nombre: string | null
        }
        SetofOptions: {
          from: "*"
          to: "materias"
          isOneToOne: true
          isSetofReturn: false
        }
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
        SetofOptions: {
          from: "*"
          to: "niveles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cambiar_profesor_asignacion: {
        Args: { p_asignacion_id: string; p_profesor_id: string }
        Returns: {
          activo: boolean
          curso_id: string
          fecha_actualizacion: string
          fecha_creacion: string
          id: string
          materia_id: number
          profesor_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "materias_cursos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancelar_inscripcion_deportiva: {
        Args: { p_inscripcion_id: string }
        Returns: {
          alumno_id: string
          deporte_id: string
          estado: Database["public"]["Enums"]["estado_inscripcion_deportiva"]
          fecha_cancelacion: string | null
          fecha_inscripcion: string
          grupo_id: string
          id: string
        }
        SetofOptions: {
          from: "*"
          to: "inscripciones_deportivas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancelar_inscripcion_servicio: {
        Args: { p_inscripcion_id: string }
        Returns: {
          alumno_id: string
          estado: Database["public"]["Enums"]["estado_inscripcion_servicio"]
          fecha_cancelacion: string | null
          fecha_inscripcion: string
          id: string
          servicio_id: string
        }
        SetofOptions: {
          from: "*"
          to: "inscripciones_servicios"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      configurar_horario_materia: {
        Args: {
          p_asignacion_id: string
          p_dia: number
          p_fin: string
          p_franja_id?: string
          p_inicio: string
        }
        Returns: {
          activo: boolean
          asignacion_id: string
          fecha_alta: string
          fecha_baja: string | null
          horario_id: string
          id: string
        }
        SetofOptions: {
          from: "*"
          to: "materias_cursos_horarios"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      consultar_compatibilidad_horaria: {
        Args: never
        Returns: {
          conflicto_deporte: string
          conflicto_dia_semana: number
          conflicto_grupo: string
          conflicto_hora_fin: string
          conflicto_hora_inicio: string
          grupo_id: string
          tiene_horario: boolean
        }[]
      }
      consultar_compatibilidad_horaria_alumno: {
        Args: { p_alumno_id: string }
        Returns: {
          conflicto_deporte: string
          conflicto_dia_semana: number
          conflicto_grupo: string
          conflicto_hora_fin: string
          conflicto_hora_inicio: string
          grupo_id: string
          tiene_horario: boolean
        }[]
      }
      consultar_detalle_hijo: { Args: { p_hijo_id: string }; Returns: Json }
      corregir_identidad_alumno: {
        Args: { p_alumno_id: string; p_dni: string; p_legajo_nro?: string }
        Returns: string
      }
      crear_alumno: {
        Args: {
          p_apellido: string
          p_curso_id?: string
          p_direccion?: string
          p_dni: string
          p_estado: string
          p_fecha_nacimiento?: string
          p_legajo_nro?: string
          p_nombre: string
          p_telefono?: string
        }
        Returns: string
      }
      crear_grupo_deportivo: {
        Args: {
          p_cupo: number
          p_deporte_id: string
          p_nivel_id: number
          p_nombre: string
          p_profesor_id: string
        }
        Returns: {
          activo: boolean
          cupo: number
          deporte_id: string
          fecha_actualizacion: string
          fecha_creacion: string
          id: string
          nivel_id: number
          nombre: string
          profesor_id: string
        }
        SetofOptions: {
          from: "*"
          to: "grupos_deportivos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      crear_materia: {
        Args: { p_nombre: string }
        Returns: {
          activo: boolean | null
          id: number | null
          nombre: string | null
        }
        SetofOptions: {
          from: "*"
          to: "materias"
          isOneToOne: true
          isSetofReturn: false
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
        SetofOptions: {
          from: "*"
          to: "niveles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      dar_de_baja_horario_grupo_deportivo: {
        Args: { p_franja_id: string; p_grupo_id: string }
        Returns: {
          activo: boolean
          fecha_alta: string
          fecha_baja: string | null
          grupo_id: string
          horario_id: string
          id: string
        }
        SetofOptions: {
          from: "*"
          to: "grupos_deportivos_horarios"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      es_director_actual: { Args: never; Returns: boolean }
      inactivar_alumno: { Args: { p_alumno_id: string }; Returns: string }
      inscribir_alumno_en_grupo_deportivo: {
        Args: { p_alumno_id: string; p_grupo_id: string }
        Returns: {
          alumno_id: string
          deporte_id: string
          estado: Database["public"]["Enums"]["estado_inscripcion_deportiva"]
          fecha_cancelacion: string | null
          fecha_inscripcion: string
          grupo_id: string
          id: string
        }
        SetofOptions: {
          from: "*"
          to: "inscripciones_deportivas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      inscribir_en_grupo_deportivo: {
        Args: { p_grupo_id: string }
        Returns: {
          alumno_id: string
          deporte_id: string
          estado: Database["public"]["Enums"]["estado_inscripcion_deportiva"]
          fecha_cancelacion: string | null
          fecha_inscripcion: string
          grupo_id: string
          id: string
        }
        SetofOptions: {
          from: "*"
          to: "inscripciones_deportivas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      inscribir_en_servicio: {
        Args: { p_servicio_id: string }
        Returns: {
          alumno_id: string
          estado: Database["public"]["Enums"]["estado_inscripcion_servicio"]
          fecha_cancelacion: string | null
          fecha_inscripcion: string
          id: string
          servicio_id: string
        }
        SetofOptions: {
          from: "*"
          to: "inscripciones_servicios"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      listar_grupos_deportivos: {
        Args: never
        Returns: {
          activo: boolean
          cupo: number
          deporte_activo: boolean
          deporte_id: string
          deporte_nombre: string
          disponibles: number
          grupo_id: string
          grupo_nombre: string
          inscripcion_propia_id: string
          nivel_id: number
          nivel_nombre: string
          ocupados: number
          profesor_apellido: string
          profesor_id: string
          profesor_nombre: string
        }[]
      }
      matricular_hijo: {
        Args: { p_curso_id: string; p_hijo_id: string }
        Returns: string
      }
      reactivar_alumno: {
        Args: { p_alumno_id: string; p_curso_id: string }
        Returns: string
      }
      renombrar_materia: {
        Args: { p_materia_id: number; p_nombre: string }
        Returns: {
          activo: boolean | null
          id: number | null
          nombre: string | null
        }
        SetofOptions: {
          from: "*"
          to: "materias"
          isOneToOne: true
          isSetofReturn: false
        }
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
        SetofOptions: {
          from: "*"
          to: "niveles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rol_actual: { Args: never; Returns: string }
    }
    Enums: {
      estado_alumno: "ACTIVO" | "INACTIVO"
      estado_inscripcion_deportiva: "ACTIVA" | "CANCELADA"
      estado_inscripcion_servicio: "ACTIVA" | "CANCELADA"
      motivo_cierre_matricula: "CAMBIO_DE_CURSO" | "INACTIVACION"
      tipo_servicio_escolar: "COMEDOR" | "TRANSPORTE"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      estado_alumno: ["ACTIVO", "INACTIVO"],
      estado_inscripcion_deportiva: ["ACTIVA", "CANCELADA"],
      estado_inscripcion_servicio: ["ACTIVA", "CANCELADA"],
      motivo_cierre_matricula: ["CAMBIO_DE_CURSO", "INACTIVACION"],
      tipo_servicio_escolar: ["COMEDOR", "TRANSPORTE"],
    },
  },
} as const
