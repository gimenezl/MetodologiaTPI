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
          cupo_maximo: number | null
          id: number
          nivel_id: number | null
          nombre: string
          tipo: string | null
        }
        Insert: {
          cupo_maximo?: number | null
          id?: number
          nivel_id?: number | null
          nombre: string
          tipo?: string | null
        }
        Update: {
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
            foreignKeyName: "inscripciones_estudiante_id_fkey"
            columns: ["estudiante_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
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
      calcular_porcentaje_asistencia: {
        Args: { p_estudiante_id: string }
        Returns: number
      }
      cambiar_curso_alumno: {
        Args: { p_alumno_id: string; p_curso_id: string }
        Returns: string
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
      es_director_actual: { Args: never; Returns: boolean }
      inactivar_alumno: { Args: { p_alumno_id: string }; Returns: string }
      reactivar_alumno: {
        Args: { p_alumno_id: string; p_curso_id: string }
        Returns: string
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
    }
    Enums: {
      estado_alumno: "ACTIVO" | "INACTIVO"
      motivo_cierre_matricula: "CAMBIO_DE_CURSO" | "INACTIVACION"
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
      motivo_cierre_matricula: ["CAMBIO_DE_CURSO", "INACTIVACION"],
    },
  },
} as const
