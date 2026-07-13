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
      categorias_producto: {
        Row: {
          creado_en: string
          empresa_id: string
          id: string
          nombre: string
        }
        Insert: {
          creado_en?: string
          empresa_id: string
          id?: string
          nombre: string
        }
        Update: {
          creado_en?: string
          empresa_id?: string
          id?: string
          nombre?: string
        }
        Relationships: [
          {
            foreignKeyName: "categorias_producto_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          activo: boolean
          comuna: string | null
          condicion_pago_dias: number
          creado_en: string
          direccion: string | null
          email: string | null
          empresa_id: string
          giro: string | null
          id: string
          razon_social: string
          rut: string
          telefono: string | null
        }
        Insert: {
          activo?: boolean
          comuna?: string | null
          condicion_pago_dias?: number
          creado_en?: string
          direccion?: string | null
          email?: string | null
          empresa_id: string
          giro?: string | null
          id?: string
          razon_social: string
          rut: string
          telefono?: string | null
        }
        Update: {
          activo?: boolean
          comuna?: string | null
          condicion_pago_dias?: number
          creado_en?: string
          direccion?: string | null
          email?: string | null
          empresa_id?: string
          giro?: string | null
          id?: string
          razon_social?: string
          rut?: string
          telefono?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clientes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      documentos_venta: {
        Row: {
          cliente_id: string
          creado_en: string
          documento_referencia_id: string | null
          emitido_en: string | null
          empresa_id: string
          error_emision: string | null
          estado: string
          exento: number
          folio: number | null
          id: string
          intentos: number
          iva: number
          neto: number
          pdf_ruta: string | null
          razon_anulacion: string | null
          tipo: string
          total: number
          track_id: string | null
          xml_timbrado: string | null
        }
        Insert: {
          cliente_id: string
          creado_en?: string
          documento_referencia_id?: string | null
          emitido_en?: string | null
          empresa_id: string
          error_emision?: string | null
          estado?: string
          exento?: number
          folio?: number | null
          id?: string
          intentos?: number
          iva?: number
          neto?: number
          pdf_ruta?: string | null
          razon_anulacion?: string | null
          tipo: string
          total?: number
          track_id?: string | null
          xml_timbrado?: string | null
        }
        Update: {
          cliente_id?: string
          creado_en?: string
          documento_referencia_id?: string | null
          emitido_en?: string | null
          empresa_id?: string
          error_emision?: string | null
          estado?: string
          exento?: number
          folio?: number | null
          id?: string
          intentos?: number
          iva?: number
          neto?: number
          pdf_ruta?: string | null
          razon_anulacion?: string | null
          tipo?: string
          total?: number
          track_id?: string | null
          xml_timbrado?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documentos_venta_empresa_id_cliente_id_fkey"
            columns: ["empresa_id", "cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "documentos_venta_empresa_id_documento_referencia_id_fkey"
            columns: ["empresa_id", "documento_referencia_id"]
            isOneToOne: false
            referencedRelation: "documentos_venta"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "documentos_venta_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      documentos_venta_lineas: {
        Row: {
          cantidad: number
          descripcion: string
          documento_id: string
          empresa_id: string
          exenta: boolean
          id: string
          precio_neto: number
          producto_id: string | null
          subtotal: number
        }
        Insert: {
          cantidad: number
          descripcion: string
          documento_id: string
          empresa_id: string
          exenta?: boolean
          id?: string
          precio_neto: number
          producto_id?: string | null
          subtotal: number
        }
        Update: {
          cantidad?: number
          descripcion?: string
          documento_id?: string
          empresa_id?: string
          exenta?: boolean
          id?: string
          precio_neto?: number
          producto_id?: string | null
          subtotal?: number
        }
        Relationships: [
          {
            foreignKeyName: "documentos_venta_lineas_empresa_id_documento_id_fkey"
            columns: ["empresa_id", "documento_id"]
            isOneToOne: false
            referencedRelation: "documentos_venta"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "documentos_venta_lineas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_venta_lineas_empresa_id_producto_id_fkey"
            columns: ["empresa_id", "producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["empresa_id", "id"]
          },
        ]
      }
      empresas: {
        Row: {
          certificado_cifrado: string | null
          certificado_password_cifrada: string | null
          comuna: string | null
          comuna_emisor: string | null
          creado_en: string
          direccion: string | null
          direccion_emisor: string | null
          dte_api_key_cifrada: string | null
          giro: string | null
          giro_emisor: string | null
          id: string
          organizacion_id: string
          razon_social: string
          resolucion_sii_fecha: string | null
          resolucion_sii_numero: number | null
          rut: string
        }
        Insert: {
          certificado_cifrado?: string | null
          certificado_password_cifrada?: string | null
          comuna?: string | null
          comuna_emisor?: string | null
          creado_en?: string
          direccion?: string | null
          direccion_emisor?: string | null
          dte_api_key_cifrada?: string | null
          giro?: string | null
          giro_emisor?: string | null
          id?: string
          organizacion_id: string
          razon_social: string
          resolucion_sii_fecha?: string | null
          resolucion_sii_numero?: number | null
          rut: string
        }
        Update: {
          certificado_cifrado?: string | null
          certificado_password_cifrada?: string | null
          comuna?: string | null
          comuna_emisor?: string | null
          creado_en?: string
          direccion?: string | null
          direccion_emisor?: string | null
          dte_api_key_cifrada?: string | null
          giro?: string | null
          giro_emisor?: string | null
          id?: string
          organizacion_id?: string
          razon_social?: string
          resolucion_sii_fecha?: string | null
          resolucion_sii_numero?: number | null
          rut?: string
        }
        Relationships: [
          {
            foreignKeyName: "empresas_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      folios_caf: {
        Row: {
          activo: boolean
          creado_en: string
          desde: number
          empresa_id: string
          hasta: number
          id: string
          siguiente: number
          tipo_documento: string
          xml_caf: string
        }
        Insert: {
          activo?: boolean
          creado_en?: string
          desde: number
          empresa_id: string
          hasta: number
          id?: string
          siguiente: number
          tipo_documento: string
          xml_caf: string
        }
        Update: {
          activo?: boolean
          creado_en?: string
          desde?: number
          empresa_id?: string
          hasta?: number
          id?: string
          siguiente?: number
          tipo_documento?: string
          xml_caf?: string
        }
        Relationships: [
          {
            foreignKeyName: "folios_caf_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      miembros: {
        Row: {
          creado_en: string
          estado: string
          id: string
          organizacion_id: string
          rol: string
          usuario_id: string
        }
        Insert: {
          creado_en?: string
          estado?: string
          id?: string
          organizacion_id: string
          rol: string
          usuario_id: string
        }
        Update: {
          creado_en?: string
          estado?: string
          id?: string
          organizacion_id?: string
          rol?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "miembros_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      organizaciones: {
        Row: {
          creado_en: string
          estado: string
          id: string
          plan_id: string | null
          razon_social: string
          rut: string
          trial_hasta: string
        }
        Insert: {
          creado_en?: string
          estado?: string
          id?: string
          plan_id?: string | null
          razon_social: string
          rut: string
          trial_hasta?: string
        }
        Update: {
          creado_en?: string
          estado?: string
          id?: string
          plan_id?: string | null
          razon_social?: string
          rut?: string
          trial_hasta?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizaciones_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "planes"
            referencedColumns: ["id"]
          },
        ]
      }
      planes: {
        Row: {
          activo: boolean
          creado_en: string
          id: string
          limites: Json
          modulos: string[]
          nombre: string
          precio_clp: number
        }
        Insert: {
          activo?: boolean
          creado_en?: string
          id?: string
          limites?: Json
          modulos?: string[]
          nombre: string
          precio_clp: number
        }
        Update: {
          activo?: boolean
          creado_en?: string
          id?: string
          limites?: Json
          modulos?: string[]
          nombre?: string
          precio_clp?: number
        }
        Relationships: []
      }
      productos: {
        Row: {
          activo: boolean
          actualizado_en: string
          categoria_id: string | null
          codigo_barras: string | null
          creado_en: string
          descripcion: string | null
          empresa_id: string
          exento: boolean
          id: string
          nombre: string
          precio_neto: number
          sku: string
          unidad: string
        }
        Insert: {
          activo?: boolean
          actualizado_en?: string
          categoria_id?: string | null
          codigo_barras?: string | null
          creado_en?: string
          descripcion?: string | null
          empresa_id: string
          exento?: boolean
          id?: string
          nombre: string
          precio_neto: number
          sku: string
          unidad?: string
        }
        Update: {
          activo?: boolean
          actualizado_en?: string
          categoria_id?: string | null
          codigo_barras?: string | null
          creado_en?: string
          descripcion?: string | null
          empresa_id?: string
          exento?: boolean
          id?: string
          nombre?: string
          precio_neto?: number
          sku?: string
          unidad?: string
        }
        Relationships: [
          {
            foreignKeyName: "productos_empresa_id_categoria_id_fkey"
            columns: ["empresa_id", "categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias_producto"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "productos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      suscripciones: {
        Row: {
          creado_en: string
          desde: string
          hasta: string | null
          id: string
          organizacion_id: string
          plan_id: string
        }
        Insert: {
          creado_en?: string
          desde?: string
          hasta?: string | null
          id?: string
          organizacion_id: string
          plan_id: string
        }
        Update: {
          creado_en?: string
          desde?: string
          hasta?: string | null
          id?: string
          organizacion_id?: string
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suscripciones_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suscripciones_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "planes"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      crear_documento_venta: {
        Args: {
          p_cliente: string
          p_empresa: string
          p_lineas: Json
          p_tipo: string
        }
        Returns: string
      }
      registrar_organizacion: {
        Args: { p_razon_social: string; p_rut: string }
        Returns: string
      }
      tomar_folio: {
        Args: { p_empresa: string; p_tipo: string }
        Returns: number
      }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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

