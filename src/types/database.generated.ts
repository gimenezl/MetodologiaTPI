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
      accesos_servicios: {
        Row: {
          alumno_id: string | null
          anonimizado_en: string | null
          credencial_id: string | null
          dia_servicio: string | null
          id: string
          intento_id: string | null
          motivo_denegacion:
            | Database["public"]["Enums"]["motivo_denegacion_acceso"]
            | null
          operador_perfil_id: string | null
          registrado_en: string
          resultado: Database["public"]["Enums"]["resultado_acceso_servicio"]
          sentido:
            | Database["public"]["Enums"]["sentido_acceso_transporte"]
            | null
          servicio_id: string
        }
        Insert: {
          alumno_id?: string | null
          anonimizado_en?: string | null
          credencial_id?: string | null
          dia_servicio?: string | null
          id?: string
          intento_id?: string | null
          motivo_denegacion?:
            | Database["public"]["Enums"]["motivo_denegacion_acceso"]
            | null
          operador_perfil_id?: string | null
          registrado_en?: string
          resultado: Database["public"]["Enums"]["resultado_acceso_servicio"]
          sentido?:
            | Database["public"]["Enums"]["sentido_acceso_transporte"]
            | null
          servicio_id: string
        }
        Update: {
          alumno_id?: string | null
          anonimizado_en?: string | null
          credencial_id?: string | null
          dia_servicio?: string | null
          id?: string
          intento_id?: string | null
          motivo_denegacion?:
            | Database["public"]["Enums"]["motivo_denegacion_acceso"]
            | null
          operador_perfil_id?: string | null
          registrado_en?: string
          resultado?: Database["public"]["Enums"]["resultado_acceso_servicio"]
          sentido?:
            | Database["public"]["Enums"]["sentido_acceso_transporte"]
            | null
          servicio_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accesos_servicios_alumno_id_fkey"
            columns: ["alumno_id"]
            isOneToOne: false
            referencedRelation: "alumnos"
            referencedColumns: ["perfil_id"]
          },
          {
            foreignKeyName: "accesos_servicios_alumno_id_fkey"
            columns: ["alumno_id"]
            isOneToOne: false
            referencedRelation: "alumnos_academicos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accesos_servicios_credencial_id_fkey"
            columns: ["credencial_id"]
            isOneToOne: false
            referencedRelation: "credenciales_qr"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accesos_servicios_operador_perfil_id_fkey"
            columns: ["operador_perfil_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accesos_servicios_servicio_id_fkey"
            columns: ["servicio_id"]
            isOneToOne: false
            referencedRelation: "recorridos_transporte"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accesos_servicios_servicio_id_fkey"
            columns: ["servicio_id"]
            isOneToOne: false
            referencedRelation: "servicios_escolares"
            referencedColumns: ["id"]
          },
        ]
      }
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
            referencedRelation: "matriculas_administracion"
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
      anulaciones_accesos_servicios: {
        Row: {
          acceso_id: string
          anonimizada_en: string | null
          anulado_en: string
          anulado_por: string | null
          motivo: string | null
        }
        Insert: {
          acceso_id: string
          anonimizada_en?: string | null
          anulado_en?: string
          anulado_por?: string | null
          motivo?: string | null
        }
        Update: {
          acceso_id?: string
          anonimizada_en?: string | null
          anulado_en?: string
          anulado_por?: string | null
          motivo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "anulaciones_accesos_servicios_acceso_id_fkey"
            columns: ["acceso_id"]
            isOneToOne: true
            referencedRelation: "accesos_servicios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anulaciones_accesos_servicios_anulado_por_fkey"
            columns: ["anulado_por"]
            isOneToOne: false
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
      comprobantes_pago: {
        Row: {
          creado_en: string
          id: string
          pago_id: string
          ruta_archivo: string
          subido_por: string
          tamano_bytes: number
          tipo_mime: string
        }
        Insert: {
          creado_en?: string
          id?: string
          pago_id: string
          ruta_archivo: string
          subido_por: string
          tamano_bytes: number
          tipo_mime: string
        }
        Update: {
          creado_en?: string
          id?: string
          pago_id?: string
          ruta_archivo?: string
          subido_por?: string
          tamano_bytes?: number
          tipo_mime?: string
        }
        Relationships: [
          {
            foreignKeyName: "comprobantes_pago_pago_padre_fk"
            columns: ["pago_id", "subido_por"]
            isOneToOne: false
            referencedRelation: "pagos"
            referencedColumns: ["id", "padre_id"]
          },
        ]
      }
      confirmaciones_inscripcion: {
        Row: {
          confirmada_en: string
          confirmada_por: string
          dominio: Database["public"]["Enums"]["dominio_inscripcion"]
          id: string
          inscripcion_deportiva_id: string | null
          inscripcion_servicio_id: string | null
          matricula_id: string | null
        }
        Insert: {
          confirmada_en?: string
          confirmada_por: string
          dominio: Database["public"]["Enums"]["dominio_inscripcion"]
          id?: string
          inscripcion_deportiva_id?: string | null
          inscripcion_servicio_id?: string | null
          matricula_id?: string | null
        }
        Update: {
          confirmada_en?: string
          confirmada_por?: string
          dominio?: Database["public"]["Enums"]["dominio_inscripcion"]
          id?: string
          inscripcion_deportiva_id?: string | null
          inscripcion_servicio_id?: string | null
          matricula_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "confirmaciones_inscripcion_confirmada_por_fkey"
            columns: ["confirmada_por"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confirmaciones_inscripcion_inscripcion_deportiva_id_fkey"
            columns: ["inscripcion_deportiva_id"]
            isOneToOne: false
            referencedRelation: "inscripciones_deportivas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confirmaciones_inscripcion_inscripcion_deportiva_id_fkey"
            columns: ["inscripcion_deportiva_id"]
            isOneToOne: false
            referencedRelation: "inscripciones_deportivas_administracion"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confirmaciones_inscripcion_inscripcion_deportiva_id_fkey"
            columns: ["inscripcion_deportiva_id"]
            isOneToOne: false
            referencedRelation: "inscripciones_deportivas_detalle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confirmaciones_inscripcion_inscripcion_servicio_id_fkey"
            columns: ["inscripcion_servicio_id"]
            isOneToOne: false
            referencedRelation: "inscripciones_servicios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confirmaciones_inscripcion_inscripcion_servicio_id_fkey"
            columns: ["inscripcion_servicio_id"]
            isOneToOne: false
            referencedRelation: "inscripciones_servicios_administracion"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confirmaciones_inscripcion_inscripcion_servicio_id_fkey"
            columns: ["inscripcion_servicio_id"]
            isOneToOne: false
            referencedRelation: "inscripciones_servicios_detalle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confirmaciones_inscripcion_matricula_id_fkey"
            columns: ["matricula_id"]
            isOneToOne: false
            referencedRelation: "alumnos_academicos"
            referencedColumns: ["matricula_id"]
          },
          {
            foreignKeyName: "confirmaciones_inscripcion_matricula_id_fkey"
            columns: ["matricula_id"]
            isOneToOne: false
            referencedRelation: "matriculas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confirmaciones_inscripcion_matricula_id_fkey"
            columns: ["matricula_id"]
            isOneToOne: false
            referencedRelation: "matriculas_administracion"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confirmaciones_inscripcion_matricula_id_fkey"
            columns: ["matricula_id"]
            isOneToOne: false
            referencedRelation: "matriculas_historial"
            referencedColumns: ["id"]
          },
        ]
      }
      credenciales_qr: {
        Row: {
          alumno_id: string
          clave_kid: string
          emitida_en: string
          emitida_por: string
          estado: Database["public"]["Enums"]["estado_credencial_qr"]
          id: string
          motivo_revocacion: string | null
          reemplaza_a: string | null
          revocada_en: string | null
          revocada_por: string | null
        }
        Insert: {
          alumno_id: string
          clave_kid: string
          emitida_en?: string
          emitida_por: string
          estado?: Database["public"]["Enums"]["estado_credencial_qr"]
          id?: string
          motivo_revocacion?: string | null
          reemplaza_a?: string | null
          revocada_en?: string | null
          revocada_por?: string | null
        }
        Update: {
          alumno_id?: string
          clave_kid?: string
          emitida_en?: string
          emitida_por?: string
          estado?: Database["public"]["Enums"]["estado_credencial_qr"]
          id?: string
          motivo_revocacion?: string | null
          reemplaza_a?: string | null
          revocada_en?: string | null
          revocada_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credenciales_qr_alumno_id_fkey"
            columns: ["alumno_id"]
            isOneToOne: false
            referencedRelation: "alumnos"
            referencedColumns: ["perfil_id"]
          },
          {
            foreignKeyName: "credenciales_qr_alumno_id_fkey"
            columns: ["alumno_id"]
            isOneToOne: false
            referencedRelation: "alumnos_academicos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credenciales_qr_emitida_por_fkey"
            columns: ["emitida_por"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credenciales_qr_reemplaza_a_fkey"
            columns: ["reemplaza_a"]
            isOneToOne: false
            referencedRelation: "credenciales_qr"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credenciales_qr_revocada_por_fkey"
            columns: ["revocada_por"]
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
            referencedRelation: "matriculas_administracion"
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
      envios_correo: {
        Row: {
          enviado_en: string | null
          estado: Database["public"]["Enums"]["estado_envio_correo"]
          fecha_programada: string
          id: string
          intentos: number
          padre_id: string
          tipo: Database["public"]["Enums"]["tipo_envio_correo"]
          ultimo_error: string | null
        }
        Insert: {
          enviado_en?: string | null
          estado?: Database["public"]["Enums"]["estado_envio_correo"]
          fecha_programada: string
          id?: string
          intentos?: number
          padre_id: string
          tipo: Database["public"]["Enums"]["tipo_envio_correo"]
          ultimo_error?: string | null
        }
        Update: {
          enviado_en?: string | null
          estado?: Database["public"]["Enums"]["estado_envio_correo"]
          fecha_programada?: string
          id?: string
          intentos?: number
          padre_id?: string
          tipo?: Database["public"]["Enums"]["tipo_envio_correo"]
          ultimo_error?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "envios_correo_padre_id_fkey"
            columns: ["padre_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      facturas: {
        Row: {
          alumno_id: string
          generada_en: string
          id: string
          periodo: string
          total: number
          vencimiento: string
        }
        Insert: {
          alumno_id: string
          generada_en?: string
          id?: string
          periodo: string
          total: number
          vencimiento: string
        }
        Update: {
          alumno_id?: string
          generada_en?: string
          id?: string
          periodo?: string
          total?: number
          vencimiento?: string
        }
        Relationships: [
          {
            foreignKeyName: "facturas_alumno_id_fkey"
            columns: ["alumno_id"]
            isOneToOne: false
            referencedRelation: "alumnos"
            referencedColumns: ["perfil_id"]
          },
          {
            foreignKeyName: "facturas_alumno_id_fkey"
            columns: ["alumno_id"]
            isOneToOne: false
            referencedRelation: "alumnos_academicos"
            referencedColumns: ["id"]
          },
        ]
      }
      feriados: {
        Row: {
          descripcion: string
          fecha: string
        }
        Insert: {
          descripcion: string
          fecha: string
        }
        Update: {
          descripcion?: string
          fecha?: string
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
            referencedRelation: "matriculas_administracion"
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
      imputaciones_pago: {
        Row: {
          activa: boolean
          alumno_id: string
          importe: number
          item_factura_id: string
          pago_id: string
        }
        Insert: {
          activa?: boolean
          alumno_id: string
          importe: number
          item_factura_id: string
          pago_id: string
        }
        Update: {
          activa?: boolean
          alumno_id?: string
          importe?: number
          item_factura_id?: string
          pago_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "imputaciones_pago_item_alumno_fk"
            columns: ["item_factura_id", "alumno_id"]
            isOneToOne: false
            referencedRelation: "items_factura"
            referencedColumns: ["id", "alumno_id"]
          },
          {
            foreignKeyName: "imputaciones_pago_pago_alumno_fk"
            columns: ["pago_id", "alumno_id"]
            isOneToOne: false
            referencedRelation: "pagos"
            referencedColumns: ["id", "alumno_id"]
          },
        ]
      }
      inscripciones: {
        Row: {
          actividad_id: number | null
          estado: string | null
          estudiante_id: string | null
          fecha_baja: string | null
          fecha_inscripcion: string | null
          id: string
        }
        Insert: {
          actividad_id?: number | null
          estado?: string | null
          estudiante_id?: string | null
          fecha_baja?: string | null
          fecha_inscripcion?: string | null
          id?: string
        }
        Update: {
          actividad_id?: number | null
          estado?: string | null
          estudiante_id?: string | null
          fecha_baja?: string | null
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
            referencedRelation: "recorridos_transporte"
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
      items_factura: {
        Row: {
          alumno_id: string
          estado_pago: Database["public"]["Enums"]["estado_pago_item"]
          factura_id: string
          id: string
          importe: number
          inscripcion_deportiva_id: string | null
          inscripcion_servicio_id: string | null
          matricula_id: string | null
          tarifa_id: string
          tipo: Database["public"]["Enums"]["concepto_economico"]
        }
        Insert: {
          alumno_id: string
          estado_pago?: Database["public"]["Enums"]["estado_pago_item"]
          factura_id: string
          id?: string
          importe: number
          inscripcion_deportiva_id?: string | null
          inscripcion_servicio_id?: string | null
          matricula_id?: string | null
          tarifa_id: string
          tipo: Database["public"]["Enums"]["concepto_economico"]
        }
        Update: {
          alumno_id?: string
          estado_pago?: Database["public"]["Enums"]["estado_pago_item"]
          factura_id?: string
          id?: string
          importe?: number
          inscripcion_deportiva_id?: string | null
          inscripcion_servicio_id?: string | null
          matricula_id?: string | null
          tarifa_id?: string
          tipo?: Database["public"]["Enums"]["concepto_economico"]
        }
        Relationships: [
          {
            foreignKeyName: "items_factura_factura_alumno_fk"
            columns: ["factura_id", "alumno_id"]
            isOneToOne: false
            referencedRelation: "facturas"
            referencedColumns: ["id", "alumno_id"]
          },
          {
            foreignKeyName: "items_factura_inscripcion_deportiva_id_fkey"
            columns: ["inscripcion_deportiva_id"]
            isOneToOne: false
            referencedRelation: "inscripciones_deportivas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_factura_inscripcion_deportiva_id_fkey"
            columns: ["inscripcion_deportiva_id"]
            isOneToOne: false
            referencedRelation: "inscripciones_deportivas_administracion"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_factura_inscripcion_deportiva_id_fkey"
            columns: ["inscripcion_deportiva_id"]
            isOneToOne: false
            referencedRelation: "inscripciones_deportivas_detalle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_factura_inscripcion_servicio_id_fkey"
            columns: ["inscripcion_servicio_id"]
            isOneToOne: false
            referencedRelation: "inscripciones_servicios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_factura_inscripcion_servicio_id_fkey"
            columns: ["inscripcion_servicio_id"]
            isOneToOne: false
            referencedRelation: "inscripciones_servicios_administracion"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_factura_inscripcion_servicio_id_fkey"
            columns: ["inscripcion_servicio_id"]
            isOneToOne: false
            referencedRelation: "inscripciones_servicios_detalle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_factura_matricula_id_fkey"
            columns: ["matricula_id"]
            isOneToOne: false
            referencedRelation: "alumnos_academicos"
            referencedColumns: ["matricula_id"]
          },
          {
            foreignKeyName: "items_factura_matricula_id_fkey"
            columns: ["matricula_id"]
            isOneToOne: false
            referencedRelation: "matriculas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_factura_matricula_id_fkey"
            columns: ["matricula_id"]
            isOneToOne: false
            referencedRelation: "matriculas_administracion"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_factura_matricula_id_fkey"
            columns: ["matricula_id"]
            isOneToOne: false
            referencedRelation: "matriculas_historial"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_factura_tarifa_tipo_fk"
            columns: ["tarifa_id", "tipo"]
            isOneToOne: false
            referencedRelation: "tarifas"
            referencedColumns: ["id", "concepto"]
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
            referencedRelation: "matriculas_administracion"
            referencedColumns: ["curso_id"]
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
            referencedRelation: "matriculas_administracion"
            referencedColumns: ["curso_id"]
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
      pagos: {
        Row: {
          alumno_id: string
          creado_en: string
          estado: Database["public"]["Enums"]["estado_pago"]
          fecha_transferencia: string | null
          id: string
          importe_informado: number | null
          motivo_rechazo: string | null
          numero_operacion: string | null
          padre_id: string
          total_calculado: number
          verificado_en: string | null
          verificado_por: string | null
        }
        Insert: {
          alumno_id: string
          creado_en?: string
          estado?: Database["public"]["Enums"]["estado_pago"]
          fecha_transferencia?: string | null
          id?: string
          importe_informado?: number | null
          motivo_rechazo?: string | null
          numero_operacion?: string | null
          padre_id: string
          total_calculado: number
          verificado_en?: string | null
          verificado_por?: string | null
        }
        Update: {
          alumno_id?: string
          creado_en?: string
          estado?: Database["public"]["Enums"]["estado_pago"]
          fecha_transferencia?: string | null
          id?: string
          importe_informado?: number | null
          motivo_rechazo?: string | null
          numero_operacion?: string | null
          padre_id?: string
          total_calculado?: number
          verificado_en?: string | null
          verificado_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pagos_alumno_id_fkey"
            columns: ["alumno_id"]
            isOneToOne: false
            referencedRelation: "alumnos"
            referencedColumns: ["perfil_id"]
          },
          {
            foreignKeyName: "pagos_alumno_id_fkey"
            columns: ["alumno_id"]
            isOneToOne: false
            referencedRelation: "alumnos_academicos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagos_padre_id_fkey"
            columns: ["padre_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagos_verificado_por_fkey"
            columns: ["verificado_por"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      paradas_recorrido: {
        Row: {
          fecha_creacion: string
          id: string
          nombre: string
          orden: number
          servicio_id: string
        }
        Insert: {
          fecha_creacion?: string
          id?: string
          nombre: string
          orden: number
          servicio_id: string
        }
        Update: {
          fecha_creacion?: string
          id?: string
          nombre?: string
          orden?: number
          servicio_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "paradas_recorrido_servicio_id_fkey"
            columns: ["servicio_id"]
            isOneToOne: false
            referencedRelation: "recorridos_transporte"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paradas_recorrido_servicio_id_fkey"
            columns: ["servicio_id"]
            isOneToOne: false
            referencedRelation: "servicios_escolares"
            referencedColumns: ["id"]
          },
        ]
      }
      perfiles: {
        Row: {
          apellido: string
          direccion: string | null
          dni: string
          estado_acceso: Database["public"]["Enums"]["estado_acceso"]
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
          estado_acceso?: Database["public"]["Enums"]["estado_acceso"]
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
          estado_acceso?: Database["public"]["Enums"]["estado_acceso"]
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
      perfiles_historial: {
        Row: {
          actor_perfil_id: string
          fecha: string
          id: number
          motivo: string
          operacion_id: string | null
          perfil_id: string
          tipo: string
          valor_anterior: string | null
          valor_nuevo: string
        }
        Insert: {
          actor_perfil_id: string
          fecha?: string
          id?: never
          motivo: string
          operacion_id?: string | null
          perfil_id: string
          tipo: string
          valor_anterior?: string | null
          valor_nuevo: string
        }
        Update: {
          actor_perfil_id?: string
          fecha?: string
          id?: never
          motivo?: string
          operacion_id?: string | null
          perfil_id?: string
          tipo?: string
          valor_anterior?: string | null
          valor_nuevo?: string
        }
        Relationships: [
          {
            foreignKeyName: "perfiles_historial_actor_perfil_id_fkey"
            columns: ["actor_perfil_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "perfiles_historial_perfil_id_fkey"
            columns: ["perfil_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
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
      profesores: {
        Row: {
          especialidad: string | null
          estado: Database["public"]["Enums"]["estado_profesor"]
          fecha_actualizacion: string
          fecha_alta: string
          perfil_id: string
        }
        Insert: {
          especialidad?: string | null
          estado?: Database["public"]["Enums"]["estado_profesor"]
          fecha_actualizacion?: string
          fecha_alta?: string
          perfil_id: string
        }
        Update: {
          especialidad?: string | null
          estado?: Database["public"]["Enums"]["estado_profesor"]
          fecha_actualizacion?: string
          fecha_alta?: string
          perfil_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profesores_perfil_id_fkey"
            columns: ["perfil_id"]
            isOneToOne: true
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profesores_estados_historial: {
        Row: {
          actor_id: string
          estado_anterior: Database["public"]["Enums"]["estado_profesor"]
          estado_nuevo: Database["public"]["Enums"]["estado_profesor"]
          fecha: string
          id: number
          motivo: string | null
          profesor_id: string
        }
        Insert: {
          actor_id: string
          estado_anterior: Database["public"]["Enums"]["estado_profesor"]
          estado_nuevo: Database["public"]["Enums"]["estado_profesor"]
          fecha?: string
          id?: never
          motivo?: string | null
          profesor_id: string
        }
        Update: {
          actor_id?: string
          estado_anterior?: Database["public"]["Enums"]["estado_profesor"]
          estado_nuevo?: Database["public"]["Enums"]["estado_profesor"]
          fecha?: string
          id?: never
          motivo?: string | null
          profesor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profesores_estados_historial_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "perfiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profesores_estados_historial_profesor_id_fkey"
            columns: ["profesor_id"]
            isOneToOne: false
            referencedRelation: "profesores"
            referencedColumns: ["perfil_id"]
          },
        ]
      }
      recibos: {
        Row: {
          archivo_path: string | null
          emitido_en: string
          id: string
          numero: number
          pago_id: string
        }
        Insert: {
          archivo_path?: string | null
          emitido_en?: string
          id?: string
          numero: number
          pago_id: string
        }
        Update: {
          archivo_path?: string | null
          emitido_en?: string
          id?: string
          numero?: number
          pago_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recibos_pago_id_fkey"
            columns: ["pago_id"]
            isOneToOne: true
            referencedRelation: "pagos"
            referencedColumns: ["id"]
          },
        ]
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
      tarifas: {
        Row: {
          concepto: Database["public"]["Enums"]["concepto_economico"]
          creada_en: string
          deporte_id: string | null
          desde: string
          hasta: string | null
          id: string
          importe: number
          nivel_id: number | null
          servicio_id: string | null
        }
        Insert: {
          concepto: Database["public"]["Enums"]["concepto_economico"]
          creada_en?: string
          deporte_id?: string | null
          desde: string
          hasta?: string | null
          id?: string
          importe: number
          nivel_id?: number | null
          servicio_id?: string | null
        }
        Update: {
          concepto?: Database["public"]["Enums"]["concepto_economico"]
          creada_en?: string
          deporte_id?: string | null
          desde?: string
          hasta?: string | null
          id?: string
          importe?: number
          nivel_id?: number | null
          servicio_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tarifas_deporte_id_fkey"
            columns: ["deporte_id"]
            isOneToOne: false
            referencedRelation: "deportes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarifas_nivel_id_fkey"
            columns: ["nivel_id"]
            isOneToOne: false
            referencedRelation: "alumnos_academicos"
            referencedColumns: ["nivel_id"]
          },
          {
            foreignKeyName: "tarifas_nivel_id_fkey"
            columns: ["nivel_id"]
            isOneToOne: false
            referencedRelation: "matriculas_administracion"
            referencedColumns: ["nivel_id"]
          },
          {
            foreignKeyName: "tarifas_nivel_id_fkey"
            columns: ["nivel_id"]
            isOneToOne: false
            referencedRelation: "matriculas_historial"
            referencedColumns: ["nivel_id"]
          },
          {
            foreignKeyName: "tarifas_nivel_id_fkey"
            columns: ["nivel_id"]
            isOneToOne: false
            referencedRelation: "niveles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarifas_servicio_id_fkey"
            columns: ["servicio_id"]
            isOneToOne: false
            referencedRelation: "recorridos_transporte"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarifas_servicio_id_fkey"
            columns: ["servicio_id"]
            isOneToOne: false
            referencedRelation: "servicios_escolares"
            referencedColumns: ["id"]
          },
        ]
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
      inscripciones_deportivas_administracion: {
        Row: {
          alumno_apellido: string | null
          alumno_estado: Database["public"]["Enums"]["estado_alumno"] | null
          alumno_id: string | null
          alumno_nombre: string | null
          confirmada: boolean | null
          confirmada_en: string | null
          confirmada_por_apellido: string | null
          confirmada_por_nombre: string | null
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
            referencedRelation: "matriculas_administracion"
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
            referencedRelation: "matriculas_administracion"
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
      inscripciones_servicios_administracion: {
        Row: {
          alumno_apellido: string | null
          alumno_estado: Database["public"]["Enums"]["estado_alumno"] | null
          alumno_id: string | null
          alumno_nombre: string | null
          confirmada: boolean | null
          confirmada_en: string | null
          confirmada_por_apellido: string | null
          confirmada_por_nombre: string | null
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
            referencedRelation: "recorridos_transporte"
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
            referencedRelation: "recorridos_transporte"
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
            referencedRelation: "matriculas_administracion"
            referencedColumns: ["curso_id"]
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
      matriculas_administracion: {
        Row: {
          alumno_apellido: string | null
          alumno_estado: Database["public"]["Enums"]["estado_alumno"] | null
          alumno_id: string | null
          alumno_nombre: string | null
          confirmada: boolean | null
          confirmada_en: string | null
          confirmada_por_apellido: string | null
          confirmada_por_nombre: string | null
          curso_denominacion: string | null
          curso_division: string | null
          curso_id: string | null
          fecha_cierre: string | null
          fecha_inicio: string | null
          id: string | null
          legajo_nro: string | null
          motivo_cierre:
            | Database["public"]["Enums"]["motivo_cierre_matricula"]
            | null
          nivel_id: number | null
          nivel_nombre: string | null
          vigente: boolean | null
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
      recorridos_transporte: {
        Row: {
          activo: boolean | null
          codigo: string | null
          id: string | null
          nombre: string | null
          paradas: Json | null
        }
        Insert: {
          activo?: boolean | null
          codigo?: string | null
          id?: string | null
          nombre?: string | null
          paradas?: never
        }
        Update: {
          activo?: boolean | null
          codigo?: string | null
          id?: string | null
          nombre?: string | null
          paradas?: never
        }
        Relationships: []
      }
    }
    Functions: {
      actualizar_ficha_profesor: {
        Args: {
          p_especialidad: string
          p_legajo_nro: string
          p_profesor_id: string
        }
        Returns: {
          especialidad: string | null
          estado: Database["public"]["Enums"]["estado_profesor"]
          fecha_actualizacion: string
          fecha_alta: string
          perfil_id: string
        }
        SetofOptions: {
          from: "*"
          to: "profesores"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      actualizar_recorrido: {
        Args: { p_activo: boolean; p_nombre: string; p_servicio_id: string }
        Returns: {
          activo: boolean
          codigo: string
          fecha_actualizacion: string
          fecha_creacion: string
          id: string
          nombre: string
          tipo: Database["public"]["Enums"]["tipo_servicio_escolar"]
        }
        SetofOptions: {
          from: "*"
          to: "servicios_escolares"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      actualizar_tarifa: {
        Args: {
          p_desde: string
          p_desde_previo: string
          p_hasta: string
          p_hasta_previo: string
          p_importe: string
          p_importe_previo: string
          p_tarifa_id: string
        }
        Returns: Json
      }
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
      anular_acceso_servicio: {
        Args: { p_acceso_id: string; p_motivo: string }
        Returns: {
          acceso_id: string
          anonimizada_en: string | null
          anulado_en: string
          anulado_por: string | null
          motivo: string | null
        }
        SetofOptions: {
          from: "*"
          to: "anulaciones_accesos_servicios"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      anular_desafio_vinculo: {
        Args: { p_director_perfil_id: string; p_operacion_id: string }
        Returns: undefined
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
      cambiar_acceso_perfil: {
        Args: {
          p_estado_esperado: Database["public"]["Enums"]["estado_acceso"]
          p_estado_nuevo: Database["public"]["Enums"]["estado_acceso"]
          p_motivo: string
          p_perfil_id: string
        }
        Returns: {
          estado_acceso: Database["public"]["Enums"]["estado_acceso"]
          historial_id: number
          perfil_id: string
          user_id: string
        }[]
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
      cambiar_estado_deporte: {
        Args: { p_activo: boolean; p_deporte_id: string }
        Returns: {
          activo: boolean
          fecha_actualizacion: string
          fecha_creacion: string
          id: string
          nombre: string
        }
        SetofOptions: {
          from: "*"
          to: "deportes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cambiar_estado_grupo_deportivo: {
        Args: { p_activo: boolean; p_grupo_id: string }
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
      cambiar_estado_profesor: {
        Args: { p_estado: string; p_motivo?: string; p_profesor_id: string }
        Returns: {
          especialidad: string | null
          estado: Database["public"]["Enums"]["estado_profesor"]
          fecha_actualizacion: string
          fecha_alta: string
          perfil_id: string
        }
        SetofOptions: {
          from: "*"
          to: "profesores"
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
      cambiar_rol_perfil: {
        Args: {
          p_motivo: string
          p_perfil_id: string
          p_rol_esperado: string
          p_rol_nuevo: string
        }
        Returns: {
          historial_id: number
          perfil_id: string
          rol: string
        }[]
      }
      cambiar_tarifa: {
        Args: {
          p_concepto: string
          p_deporte_id: string
          p_desde: string
          p_hasta: string
          p_importe: string
          p_nivel_id: number
          p_servicio_id: string
        }
        Returns: Json
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
      cancelar_inscripcion_deportiva_administrativa: {
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
      cancelar_inscripcion_servicio_administrativa: {
        Args: {
          p_inscripcion_id: string
          p_tipo: Database["public"]["Enums"]["tipo_servicio_escolar"]
        }
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
      cancelar_vinculo: {
        Args: { p_operacion_id: string }
        Returns: {
          correo_enmascarado: string
          correo_verificado: boolean
          desafio_emitido: boolean
          estado: string
          intentos_restantes: number
          operacion_id: string
          perfil_id: string
          vence_en: string
          vinculado: boolean
        }[]
      }
      catalogos_reportes: { Args: never; Returns: Json }
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
      confirmar_inscripcion_deportiva: {
        Args: { p_inscripcion_id: string }
        Returns: Json
      }
      confirmar_inscripcion_servicio: {
        Args: {
          p_inscripcion_id: string
          p_tipo: Database["public"]["Enums"]["tipo_servicio_escolar"]
        }
        Returns: Json
      }
      confirmar_matricula: { Args: { p_matricula_id: string }; Returns: Json }
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
      consultar_cupos_actividades_legadas: {
        Args: never
        Returns: {
          actividad_id: number
          inscriptos: number
        }[]
      }
      consultar_detalle_hijo: { Args: { p_hijo_id: string }; Returns: Json }
      consultar_ficha_profesor: {
        Args: { p_profesor_id?: string }
        Returns: {
          apellido: string
          direccion: string
          dni: string
          especialidad: string
          estado: Database["public"]["Enums"]["estado_profesor"]
          fecha_actualizacion: string
          fecha_alta: string
          fecha_nacimiento: string
          ficha_completa: boolean
          legajo_nro: string
          nombre: string
          perfil_id: string
          rol_docente_vigente: boolean
          telefono: string
        }[]
      }
      consultar_usuario: {
        Args: { p_perfil_id: string }
        Returns: {
          apellido: string
          bloqueo_auth: boolean
          correo_confirmado: boolean
          correo_enmascarado: string
          cuenta_existente: boolean
          direccion: string
          dni: string
          es_director_efectivo: boolean
          estado_acceso: Database["public"]["Enums"]["estado_acceso"]
          fecha_creacion: string
          fecha_nacimiento: string
          id: string
          legajo_nro: string
          nombre: string
          puede_vincular: boolean
          rol: string
          telefono: string
          tiene_cuenta: boolean
          ultimo_ingreso: string
          vinculo_pendiente_operacion: string
          vinculo_pendiente_vence_en: string
        }[]
      }
      consultar_validez_credencial_qr: {
        Args: { p_credencial_id: string }
        Returns: {
          acceso_alumno: Database["public"]["Enums"]["estado_acceso"]
          credencial_id: string
          estado_alumno: Database["public"]["Enums"]["estado_alumno"]
          estado_credencial: Database["public"]["Enums"]["estado_credencial_qr"]
          valida: boolean
        }[]
      }
      consultar_vinculo: {
        Args: { p_operacion_id: string }
        Returns: {
          correo_enmascarado: string
          correo_verificado: boolean
          desafio_emitido: boolean
          estado: string
          intentos_restantes: number
          operacion_id: string
          perfil_id: string
          vence_en: string
          vinculado: boolean
        }[]
      }
      consumir_cupo_escaneo: {
        Args: { p_actor_user_id: string }
        Returns: {
          permitido: boolean
          reintentar_en_segundos: number
        }[]
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
      crear_deporte: {
        Args: { p_nombre: string }
        Returns: {
          activo: boolean
          fecha_actualizacion: string
          fecha_creacion: string
          id: string
          nombre: string
        }
        SetofOptions: {
          from: "*"
          to: "deportes"
          isOneToOne: true
          isSetofReturn: false
        }
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
      crear_tarifa: {
        Args: {
          p_concepto: string
          p_deporte_id: string
          p_desde: string
          p_hasta: string
          p_importe: string
          p_nivel_id: number
          p_servicio_id: string
        }
        Returns: Json
      }
      dar_baja_inscripcion_legada: {
        Args: { p_inscripcion_id: string }
        Returns: string
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
      datos_para_enlace: {
        Args: { p_director_perfil_id: string; p_operacion_id: string }
        Returns: {
          correo: string
          cuenta_id: string
          estado: string
          perfil_id: string
          vinculado: boolean
        }[]
      }
      editar_grupo_deportivo: {
        Args: {
          p_cupo: number
          p_grupo_id: string
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
      emitir_credencial_qr: {
        Args: { p_alumno_id: string; p_clave_kid: string }
        Returns: {
          alumno_id: string
          clave_kid: string
          emitida_en: string
          emitida_por: string
          estado: Database["public"]["Enums"]["estado_credencial_qr"]
          id: string
          motivo_revocacion: string | null
          reemplaza_a: string | null
          revocada_en: string | null
          revocada_por: string | null
        }
        SetofOptions: {
          from: "*"
          to: "credenciales_qr"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      emitir_desafio_vinculo: {
        Args: {
          p_correo: string
          p_director_perfil_id: string
          p_operacion_id: string
        }
        Returns: {
          codigo: string
          correo: string
          desafio_vence_en: string
        }[]
      }
      es_director_actual: { Args: never; Returns: boolean }
      establecer_recorrido_transporte: {
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
      estado_acceso_de: {
        Args: { p_perfil_id: string }
        Returns: {
          estado_acceso: Database["public"]["Enums"]["estado_acceso"]
          user_id: string
        }[]
      }
      historial_credenciales_qr: {
        Args: { p_alumno_id: string }
        Returns: {
          emitida_en: string
          emitida_por_nombre: string
          estado: Database["public"]["Enums"]["estado_credencial_qr"]
          id: string
          motivo_revocacion: string
          reemplaza_a: string
          revocada_en: string
          revocada_por_nombre: string
        }[]
      }
      inactivar_alumno: { Args: { p_alumno_id: string }; Returns: string }
      inscribir_actividad_legada: {
        Args: { p_actividad_id: number; p_estudiante_id: string }
        Returns: string
      }
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
      listar_accesos_servicios: {
        Args: {
          p_desplazamiento?: number
          p_dia?: string
          p_limite?: number
          p_resultado?: Database["public"]["Enums"]["resultado_acceso_servicio"]
          p_servicio_id?: string
        }
        Returns: {
          alumno_apellido: string
          alumno_legajo: string
          alumno_nombre: string
          anonimizado: boolean
          anulado: boolean
          anulado_en: string
          anulado_motivo: string
          anulado_por_nombre: string
          dia_servicio: string
          id: string
          motivo_denegacion: Database["public"]["Enums"]["motivo_denegacion_acceso"]
          operador_nombre: string
          registrado_en: string
          resultado: Database["public"]["Enums"]["resultado_acceso_servicio"]
          sentido: Database["public"]["Enums"]["sentido_acceso_transporte"]
          servicio_nombre: string
          servicio_tipo: Database["public"]["Enums"]["tipo_servicio_escolar"]
          total: number
        }[]
      }
      listar_asignaciones_profesor: {
        Args: { p_profesor_id?: string }
        Returns: {
          actividad_activa: boolean
          actividad_nombre: string
          curso_activo: boolean
          curso_denominacion: string
          curso_division: string
          curso_id: string
          fecha_actualizacion: string
          grupo_nombre: string
          nivel_id: number
          nivel_nombre: string
          relacion_id: string
          tipo: string
          vigente: boolean
        }[]
      }
      listar_estudiantes_para_gestion: {
        Args: never
        Returns: {
          apellido: string
          id: string
          legajo_nro: string
          nombre: string
        }[]
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
      listar_historial_estados_profesor: {
        Args: { p_profesor_id: string }
        Returns: {
          actor_apellido: string
          actor_id: string
          actor_nombre: string
          estado_anterior: Database["public"]["Enums"]["estado_profesor"]
          estado_nuevo: Database["public"]["Enums"]["estado_profesor"]
          fecha: string
          id: number
          motivo: string
        }[]
      }
      listar_historial_usuario: {
        Args: { p_perfil_id: string }
        Returns: {
          actor_apellido: string
          actor_nombre: string
          actor_perfil_id: string
          fecha: string
          id: number
          motivo: string
          operacion_id: string
          tipo: string
          valor_anterior: string
          valor_nuevo: string
        }[]
      }
      listar_horarios_profesor: {
        Args: { p_profesor_id?: string }
        Returns: {
          dia_semana: number
          franja_id: string
          hora_fin: string
          hora_inicio: string
          relacion_id: string
          tipo: string
        }[]
      }
      listar_inscripciones_actividades_legadas: {
        Args: { p_estudiante_id: string; p_incluir_bajas?: boolean }
        Returns: {
          actividad_id: number
          actividad_nombre: string
          actividad_tipo: string
          cupo_maximo: number
          estado: string
          estudiante_id: string
          fecha_baja: string
          fecha_inscripcion: string
          id: string
        }[]
      }
      listar_inscriptos_actividad_legada: {
        Args: { p_actividad_id: number }
        Returns: {
          estudiante_id: string
          fecha_inscripcion: string
          inscripcion_id: string
        }[]
      }
      listar_profesores: {
        Args: never
        Returns: {
          apellido: string
          asignaciones_activas: number
          especialidad: string
          estado: Database["public"]["Enums"]["estado_profesor"]
          fecha_actualizacion: string
          fecha_alta: string
          ficha_completa: boolean
          grupos_activos: number
          legajo_nro: string
          nombre: string
          perfil_id: string
          rol_docente_vigente: boolean
        }[]
      }
      listar_usuarios: {
        Args: {
          p_busqueda?: string
          p_desplazamiento?: number
          p_limite?: number
        }
        Returns: {
          apellido: string
          bloqueo_auth: boolean
          correo_confirmado: boolean
          correo_enmascarado: string
          cuenta_existente: boolean
          dni: string
          es_director_efectivo: boolean
          estado_acceso: Database["public"]["Enums"]["estado_acceso"]
          id: string
          legajo_nro: string
          nombre: string
          rol: string
          tiene_cuenta: boolean
          total: number
        }[]
      }
      matricular_hijo: {
        Args: { p_curso_id: string; p_hijo_id: string }
        Returns: string
      }
      mi_estado_acceso: { Args: never; Returns: string }
      reactivar_alumno: {
        Args: { p_alumno_id: string; p_curso_id: string }
        Returns: string
      }
      registrar_acceso_servicio: {
        Args: {
          p_actor_user_id: string
          p_clave_kid: string
          p_credencial_id: string
          p_intento_id: string
          p_sentido?: Database["public"]["Enums"]["sentido_acceso_transporte"]
          p_servicio_id: string
        }
        Returns: {
          alumno_apellido: string
          alumno_legajo: string
          alumno_nombre: string
          codigo_resultado: string
          sellado_en: string
        }[]
      }
      registrar_asistencia: {
        Args: { p_estado: string; p_estudiante_id: string; p_fecha: string }
        Returns: {
          docente_id: string
          estado: string
          estudiante_id: string
          fecha: string
          id: string
          resultado: string
        }[]
      }
      registrar_escaneo_invalido: {
        Args: { p_actor_user_id: string }
        Returns: {
          bloqueado: boolean
          reintentar_en_segundos: number
        }[]
      }
      renombrar_deporte: {
        Args: { p_deporte_id: string; p_nombre: string }
        Returns: {
          activo: boolean
          fecha_actualizacion: string
          fecha_creacion: string
          id: string
          nombre: string
        }
        SetofOptions: {
          from: "*"
          to: "deportes"
          isOneToOne: true
          isSetofReturn: false
        }
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
      reponer_credencial_qr: {
        Args: { p_clave_kid: string; p_credencial_id: string; p_motivo: string }
        Returns: {
          alumno_id: string
          clave_kid: string
          emitida_en: string
          emitida_por: string
          estado: Database["public"]["Enums"]["estado_credencial_qr"]
          id: string
          motivo_revocacion: string | null
          reemplaza_a: string | null
          revocada_en: string | null
          revocada_por: string | null
        }
        SetofOptions: {
          from: "*"
          to: "credenciales_qr"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reporte_alumnos_curso: {
        Args: {
          p_busqueda?: string
          p_curso_id?: string
          p_deporte_id?: string
          p_desplazamiento?: number
          p_horario_id?: string
          p_incluir_historial?: boolean
          p_limite?: number
          p_materia_id?: number
          p_nivel_id?: number
          p_profesor_id?: string
          p_servicio_id?: string
        }
        Returns: {
          alumno_apellido: string
          alumno_estado: Database["public"]["Enums"]["estado_alumno"]
          alumno_nombre: string
          curso_denominacion: string
          curso_division: string
          curso_id: string
          fecha_cierre: string
          fecha_inicio: string
          id: string
          legajo_nro: string
          motivo_cierre: Database["public"]["Enums"]["motivo_cierre_matricula"]
          nivel_id: number
          nivel_nombre: string
          total_filas: number
          vigente: boolean
        }[]
      }
      reporte_alumnos_deporte: {
        Args: {
          p_busqueda?: string
          p_curso_id?: string
          p_deporte_id?: string
          p_desplazamiento?: number
          p_horario_id?: string
          p_incluir_historial?: boolean
          p_limite?: number
          p_materia_id?: number
          p_nivel_id?: number
          p_profesor_id?: string
          p_servicio_id?: string
        }
        Returns: {
          alumno_apellido: string
          alumno_nombre: string
          curso_denominacion: string
          curso_division: string
          deporte_id: string
          deporte_nombre: string
          estado: Database["public"]["Enums"]["estado_inscripcion_deportiva"]
          fecha_cancelacion: string
          fecha_inscripcion: string
          grupo_id: string
          grupo_nombre: string
          id: string
          legajo_nro: string
          nivel_id: number
          nivel_nombre: string
          responsable_apellido: string
          responsable_nombre: string
          total_filas: number
        }[]
      }
      reporte_alumnos_horario: {
        Args: {
          p_busqueda?: string
          p_curso_id?: string
          p_deporte_id?: string
          p_desplazamiento?: number
          p_horario_id?: string
          p_limite?: number
          p_materia_id?: number
          p_nivel_id?: number
          p_origen?: string
          p_profesor_id?: string
          p_servicio_id?: string
        }
        Returns: {
          actividad_nombre: string
          alumno_apellido: string
          alumno_nombre: string
          curso_denominacion: string
          curso_division: string
          dia_semana: number
          grupo_nombre: string
          hora_fin: string
          hora_inicio: string
          id: string
          legajo_nro: string
          nivel_id: number
          nivel_nombre: string
          origen: string
          responsable_apellido: string
          responsable_nombre: string
          total_filas: number
        }[]
      }
      reporte_alumnos_materia: {
        Args: {
          p_busqueda?: string
          p_curso_id?: string
          p_deporte_id?: string
          p_desplazamiento?: number
          p_horario_id?: string
          p_limite?: number
          p_materia_id?: number
          p_nivel_id?: number
          p_profesor_id?: string
          p_servicio_id?: string
        }
        Returns: {
          alumno_apellido: string
          alumno_nombre: string
          curso_denominacion: string
          curso_division: string
          curso_id: string
          id: string
          legajo_nro: string
          materia_id: number
          materia_nombre: string
          nivel_id: number
          nivel_nombre: string
          responsable_apellido: string
          responsable_nombre: string
          total_filas: number
        }[]
      }
      reporte_alumnos_recorrido: {
        Args: {
          p_busqueda?: string
          p_curso_id?: string
          p_deporte_id?: string
          p_desplazamiento?: number
          p_horario_id?: string
          p_incluir_historial?: boolean
          p_limite?: number
          p_materia_id?: number
          p_nivel_id?: number
          p_profesor_id?: string
          p_servicio_id?: string
        }
        Returns: {
          alumno_apellido: string
          alumno_nombre: string
          curso_denominacion: string
          curso_division: string
          estado: Database["public"]["Enums"]["estado_inscripcion_servicio"]
          fecha_cancelacion: string
          fecha_inscripcion: string
          id: string
          legajo_nro: string
          nivel_id: number
          nivel_nombre: string
          paradas: string
          recorrido_codigo: string
          recorrido_id: string
          recorrido_nombre: string
          total_filas: number
        }[]
      }
      reporte_docentes_nivel: {
        Args: {
          p_busqueda?: string
          p_curso_id?: string
          p_deporte_id?: string
          p_desplazamiento?: number
          p_horario_id?: string
          p_limite?: number
          p_materia_id?: number
          p_nivel_id?: number
          p_origen?: string
          p_profesor_id?: string
        }
        Returns: {
          actividad_nombre: string
          curso_denominacion: string
          curso_division: string
          docente_apellido: string
          docente_estado: Database["public"]["Enums"]["estado_profesor"]
          docente_nombre: string
          especialidad: string
          grupo_nombre: string
          id: string
          nivel_id: number
          nivel_nombre: string
          origen: string
          total_filas: number
        }[]
      }
      reservar_vinculo_cuenta: {
        Args: {
          p_dni: string
          p_documento_verificado: boolean
          p_modalidad: string
          p_operacion_id: string
          p_perfil_id: string
          p_representante_dni: string
        }
        Returns: {
          correo_enmascarado: string
          correo_verificado: boolean
          desafio_emitido: boolean
          estado: string
          intentos_restantes: number
          operacion_id: string
          perfil_id: string
          vence_en: string
        }[]
      }
      resumen_comprobantes_pago: {
        Args: { p_pago_id: string }
        Returns: {
          cantidad_archivos: number
          pago_id: string
          ultima_carga_en: string
        }[]
      }
      revocar_credencial_qr: {
        Args: { p_credencial_id: string; p_motivo: string }
        Returns: {
          alumno_id: string
          clave_kid: string
          emitida_en: string
          emitida_por: string
          estado: Database["public"]["Enums"]["estado_credencial_qr"]
          id: string
          motivo_revocacion: string | null
          reemplaza_a: string | null
          revocada_en: string | null
          revocada_por: string | null
        }
        SetofOptions: {
          from: "*"
          to: "credenciales_qr"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rol_actual: { Args: never; Returns: string }
      verificar_desafio_vinculo: {
        Args: {
          p_codigo: string
          p_director_perfil_id: string
          p_operacion_id: string
        }
        Returns: {
          intentos_restantes: number
          resultado: string
        }[]
      }
    }
    Enums: {
      concepto_economico: "CUOTA" | "DEPORTE" | "TRANSPORTE" | "COMEDOR"
      dominio_inscripcion: "MATRICULA" | "DEPORTE" | "SERVICIO"
      estado_acceso: "HABILITADO" | "BLOQUEADO"
      estado_alumno: "ACTIVO" | "INACTIVO"
      estado_credencial_qr: "ACTIVA" | "REVOCADA"
      estado_envio_correo: "PENDIENTE" | "ENVIADO" | "FALLIDO" | "INCIERTO"
      estado_inscripcion_deportiva: "ACTIVA" | "CANCELADA"
      estado_inscripcion_servicio: "ACTIVA" | "CANCELADA"
      estado_pago: "PENDIENTE_VERIFICACION" | "APROBADO" | "RECHAZADO"
      estado_pago_item: "PENDIENTE" | "EN_VERIFICACION" | "PAGADO"
      estado_profesor: "ACTIVO" | "INACTIVO"
      motivo_cierre_matricula: "CAMBIO_DE_CURSO" | "INACTIVACION"
      motivo_denegacion_acceso:
        | "YA_REGISTRADO"
        | "CREDENCIAL_REVOCADA"
        | "ALUMNO_INACTIVO"
        | "ACCESO_BLOQUEADO"
        | "SERVICIO_INACTIVO"
        | "SIN_INSCRIPCION"
        | "RECORRIDO_DISTINTO"
      resultado_acceso_servicio: "REGISTRADO" | "DENEGADO"
      sentido_acceso_transporte: "IDA" | "VUELTA"
      tipo_envio_correo: "RECORDATORIO_MENSUAL" | "AVISO_DEUDA"
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
      concepto_economico: ["CUOTA", "DEPORTE", "TRANSPORTE", "COMEDOR"],
      dominio_inscripcion: ["MATRICULA", "DEPORTE", "SERVICIO"],
      estado_acceso: ["HABILITADO", "BLOQUEADO"],
      estado_alumno: ["ACTIVO", "INACTIVO"],
      estado_credencial_qr: ["ACTIVA", "REVOCADA"],
      estado_envio_correo: ["PENDIENTE", "ENVIADO", "FALLIDO", "INCIERTO"],
      estado_inscripcion_deportiva: ["ACTIVA", "CANCELADA"],
      estado_inscripcion_servicio: ["ACTIVA", "CANCELADA"],
      estado_pago: ["PENDIENTE_VERIFICACION", "APROBADO", "RECHAZADO"],
      estado_pago_item: ["PENDIENTE", "EN_VERIFICACION", "PAGADO"],
      estado_profesor: ["ACTIVO", "INACTIVO"],
      motivo_cierre_matricula: ["CAMBIO_DE_CURSO", "INACTIVACION"],
      motivo_denegacion_acceso: [
        "YA_REGISTRADO",
        "CREDENCIAL_REVOCADA",
        "ALUMNO_INACTIVO",
        "ACCESO_BLOQUEADO",
        "SERVICIO_INACTIVO",
        "SIN_INSCRIPCION",
        "RECORRIDO_DISTINTO",
      ],
      resultado_acceso_servicio: ["REGISTRADO", "DENEGADO"],
      sentido_acceso_transporte: ["IDA", "VUELTA"],
      tipo_envio_correo: ["RECORDATORIO_MENSUAL", "AVISO_DEUDA"],
      tipo_servicio_escolar: ["COMEDOR", "TRANSPORTE"],
    },
  },
} as const
