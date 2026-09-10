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
            referencedRelation: "niveles"
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
          comentario: string
          fecha: string | null
          id: number
          nombre_usuario: string | null
        }
        Insert: {
          comentario: string
          fecha?: string | null
          id?: number
          nombre_usuario?: string | null
        }
        Update: {
          comentario?: string
          fecha?: string | null
          id?: number
          nombre_usuario?: string | null
        }
        Relationships: []
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
      [_ in never]: never
    }
    Functions: {
      calcular_porcentaje_asistencia: {
        Args: { p_estudiante_id: string }
        Returns: number
      }
      es_director_actual: { Args: never; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
