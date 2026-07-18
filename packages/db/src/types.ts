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
      anticipos: {
        Row: {
          cliente_id: string
          documento_venta_id: string | null
          empresa_id: string
          estado: string
          id: string
          monto: number
          mp_payment_id: string | null
          origen_id: string
          origen_tipo: string
          pago_id: string | null
          recibido_en: string
        }
        Insert: {
          cliente_id: string
          documento_venta_id?: string | null
          empresa_id: string
          estado?: string
          id?: string
          monto: number
          mp_payment_id?: string | null
          origen_id: string
          origen_tipo: string
          pago_id?: string | null
          recibido_en?: string
        }
        Update: {
          cliente_id?: string
          documento_venta_id?: string | null
          empresa_id?: string
          estado?: string
          id?: string
          monto?: number
          mp_payment_id?: string | null
          origen_id?: string
          origen_tipo?: string
          pago_id?: string | null
          recibido_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "anticipos_empresa_id_cliente_id_fkey"
            columns: ["empresa_id", "cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "anticipos_empresa_id_documento_venta_id_fkey"
            columns: ["empresa_id", "documento_venta_id"]
            isOneToOne: false
            referencedRelation: "documentos_venta"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "anticipos_empresa_id_documento_venta_id_fkey"
            columns: ["empresa_id", "documento_venta_id"]
            isOneToOne: false
            referencedRelation: "libro_ventas"
            referencedColumns: ["empresa_id", "documento_id"]
          },
          {
            foreignKeyName: "anticipos_empresa_id_documento_venta_id_fkey"
            columns: ["empresa_id", "documento_venta_id"]
            isOneToOne: false
            referencedRelation: "saldos_documentos"
            referencedColumns: ["empresa_id", "documento_id"]
          },
          {
            foreignKeyName: "anticipos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anticipos_empresa_id_pago_id_fkey"
            columns: ["empresa_id", "pago_id"]
            isOneToOne: false
            referencedRelation: "pagos"
            referencedColumns: ["empresa_id", "id"]
          },
        ]
      }
      asientos: {
        Row: {
          creado_en: string
          creado_por: string | null
          empresa_id: string
          fecha: string
          glosa: string
          id: string
          numero: number
          origen: string
          referencia_id: string | null
          reversa_de: string | null
        }
        Insert: {
          creado_en?: string
          creado_por?: string | null
          empresa_id: string
          fecha: string
          glosa: string
          id?: string
          numero: number
          origen: string
          referencia_id?: string | null
          reversa_de?: string | null
        }
        Update: {
          creado_en?: string
          creado_por?: string | null
          empresa_id?: string
          fecha?: string
          glosa?: string
          id?: string
          numero?: number
          origen?: string
          referencia_id?: string | null
          reversa_de?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asientos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asientos_empresa_id_reversa_de_fkey"
            columns: ["empresa_id", "reversa_de"]
            isOneToOne: false
            referencedRelation: "asientos"
            referencedColumns: ["empresa_id", "id"]
          },
        ]
      }
      asientos_lineas: {
        Row: {
          asiento_id: string
          cuenta_id: string
          debe: number
          empresa_id: string
          glosa: string | null
          haber: number
          id: string
        }
        Insert: {
          asiento_id: string
          cuenta_id: string
          debe?: number
          empresa_id: string
          glosa?: string | null
          haber?: number
          id?: string
        }
        Update: {
          asiento_id?: string
          cuenta_id?: string
          debe?: number
          empresa_id?: string
          glosa?: string | null
          haber?: number
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asientos_lineas_empresa_id_asiento_id_fkey"
            columns: ["empresa_id", "asiento_id"]
            isOneToOne: false
            referencedRelation: "asientos"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "asientos_lineas_empresa_id_cuenta_id_fkey"
            columns: ["empresa_id", "cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas_contables"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "asientos_lineas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      bodegas: {
        Row: {
          activo: boolean
          creado_en: string
          direccion: string | null
          empresa_id: string
          id: string
          nombre: string
        }
        Insert: {
          activo?: boolean
          creado_en?: string
          direccion?: string | null
          empresa_id: string
          id?: string
          nombre: string
        }
        Update: {
          activo?: boolean
          creado_en?: string
          direccion?: string | null
          empresa_id?: string
          id?: string
          nombre?: string
        }
        Relationships: [
          {
            foreignKeyName: "bodegas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      cargas_combustible: {
        Row: {
          comuna: string | null
          conductor_id: string | null
          creado_en: string
          empresa_id: string
          estacion: string | null
          fecha: string
          guia: string | null
          hora: string | null
          id: string
          litros: number
          monto: number
          odometro: number | null
          origen: string
          precio_litro: number | null
          producto: string
          rut_chofer: string | null
          tarjeta: string | null
          vehiculo_id: string
        }
        Insert: {
          comuna?: string | null
          conductor_id?: string | null
          creado_en?: string
          empresa_id: string
          estacion?: string | null
          fecha: string
          guia?: string | null
          hora?: string | null
          id?: string
          litros: number
          monto: number
          odometro?: number | null
          origen: string
          precio_litro?: number | null
          producto?: string
          rut_chofer?: string | null
          tarjeta?: string | null
          vehiculo_id: string
        }
        Update: {
          comuna?: string | null
          conductor_id?: string | null
          creado_en?: string
          empresa_id?: string
          estacion?: string | null
          fecha?: string
          guia?: string | null
          hora?: string | null
          id?: string
          litros?: number
          monto?: number
          odometro?: number | null
          origen?: string
          precio_litro?: number | null
          producto?: string
          rut_chofer?: string | null
          tarjeta?: string | null
          vehiculo_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cargas_combustible_empresa_id_conductor_id_fkey"
            columns: ["empresa_id", "conductor_id"]
            isOneToOne: false
            referencedRelation: "conductores"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "cargas_combustible_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cargas_combustible_empresa_id_vehiculo_id_fkey"
            columns: ["empresa_id", "vehiculo_id"]
            isOneToOne: false
            referencedRelation: "vehiculos"
            referencedColumns: ["empresa_id", "id"]
          },
        ]
      }
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
      conductores: {
        Row: {
          activo: boolean
          creado_en: string
          empresa_id: string
          id: string
          nombre: string
          rut: string
          telefono: string | null
        }
        Insert: {
          activo?: boolean
          creado_en?: string
          empresa_id: string
          id?: string
          nombre: string
          rut: string
          telefono?: string | null
        }
        Update: {
          activo?: boolean
          creado_en?: string
          empresa_id?: string
          id?: string
          nombre?: string
          rut?: string
          telefono?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conductores_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      correos_enviados: {
        Row: {
          asunto: string
          creado_en: string
          empresa_id: string
          html: string | null
          id: string
          para: string
          proveedor_id: string
          referencia_id: string
          tipo: string
        }
        Insert: {
          asunto: string
          creado_en?: string
          empresa_id: string
          html?: string | null
          id?: string
          para: string
          proveedor_id: string
          referencia_id: string
          tipo: string
        }
        Update: {
          asunto?: string
          creado_en?: string
          empresa_id?: string
          html?: string | null
          id?: string
          para?: string
          proveedor_id?: string
          referencia_id?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "correos_enviados_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      cotizaciones: {
        Row: {
          cliente_id: string
          creado_en: string
          documento_venta_id: string | null
          empresa_id: string
          estado: string
          exento: number
          fecha_validez: string
          id: string
          iva: number
          motivo_rechazo: string | null
          neto: number
          notas: string | null
          numero: number
          total: number
        }
        Insert: {
          cliente_id: string
          creado_en?: string
          documento_venta_id?: string | null
          empresa_id: string
          estado?: string
          exento?: number
          fecha_validez: string
          id?: string
          iva?: number
          motivo_rechazo?: string | null
          neto?: number
          notas?: string | null
          numero: number
          total?: number
        }
        Update: {
          cliente_id?: string
          creado_en?: string
          documento_venta_id?: string | null
          empresa_id?: string
          estado?: string
          exento?: number
          fecha_validez?: string
          id?: string
          iva?: number
          motivo_rechazo?: string | null
          neto?: number
          notas?: string | null
          numero?: number
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "cotizaciones_empresa_id_cliente_id_fkey"
            columns: ["empresa_id", "cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "cotizaciones_empresa_id_documento_venta_id_fkey"
            columns: ["empresa_id", "documento_venta_id"]
            isOneToOne: false
            referencedRelation: "documentos_venta"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "cotizaciones_empresa_id_documento_venta_id_fkey"
            columns: ["empresa_id", "documento_venta_id"]
            isOneToOne: false
            referencedRelation: "libro_ventas"
            referencedColumns: ["empresa_id", "documento_id"]
          },
          {
            foreignKeyName: "cotizaciones_empresa_id_documento_venta_id_fkey"
            columns: ["empresa_id", "documento_venta_id"]
            isOneToOne: false
            referencedRelation: "saldos_documentos"
            referencedColumns: ["empresa_id", "documento_id"]
          },
          {
            foreignKeyName: "cotizaciones_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      cotizaciones_lineas: {
        Row: {
          cantidad: number
          cotizacion_id: string
          descripcion: string
          empresa_id: string
          exenta: boolean
          id: string
          precio_neto: number
          producto_id: string
          subtotal: number
        }
        Insert: {
          cantidad: number
          cotizacion_id: string
          descripcion: string
          empresa_id: string
          exenta?: boolean
          id?: string
          precio_neto: number
          producto_id: string
          subtotal: number
        }
        Update: {
          cantidad?: number
          cotizacion_id?: string
          descripcion?: string
          empresa_id?: string
          exenta?: boolean
          id?: string
          precio_neto?: number
          producto_id?: string
          subtotal?: number
        }
        Relationships: [
          {
            foreignKeyName: "cotizaciones_lineas_empresa_id_cotizacion_id_fkey"
            columns: ["empresa_id", "cotizacion_id"]
            isOneToOne: false
            referencedRelation: "cotizaciones"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "cotizaciones_lineas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_lineas_empresa_id_producto_id_fkey"
            columns: ["empresa_id", "producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "cotizaciones_lineas_empresa_id_producto_id_fkey"
            columns: ["empresa_id", "producto_id"]
            isOneToOne: false
            referencedRelation: "valorizacion_inventario"
            referencedColumns: ["empresa_id", "producto_id"]
          },
        ]
      }
      cuentas_contables: {
        Row: {
          acepta_movimientos: boolean
          activa: boolean
          clave_sistema: string | null
          codigo: string
          creado_en: string
          empresa_id: string
          id: string
          nombre: string
          tipo: string
        }
        Insert: {
          acepta_movimientos?: boolean
          activa?: boolean
          clave_sistema?: string | null
          codigo: string
          creado_en?: string
          empresa_id: string
          id?: string
          nombre: string
          tipo: string
        }
        Update: {
          acepta_movimientos?: boolean
          activa?: boolean
          clave_sistema?: string | null
          codigo?: string
          creado_en?: string
          empresa_id?: string
          id?: string
          nombre?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "cuentas_contables_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      destinos: {
        Row: {
          activo: boolean
          creado_en: string
          empresa_id: string
          id: string
          nombre: string
          tarifa_kg: number
        }
        Insert: {
          activo?: boolean
          creado_en?: string
          empresa_id: string
          id?: string
          nombre: string
          tarifa_kg: number
        }
        Update: {
          activo?: boolean
          creado_en?: string
          empresa_id?: string
          id?: string
          nombre?: string
          tarifa_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "destinos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      documentos_compra: {
        Row: {
          creado_en: string
          empresa_id: string
          estado: string
          exento: number
          fecha_emision: string
          folio: number
          id: string
          iva: number
          motivo_anulacion: string | null
          neto: number
          notas: string | null
          orden_id: string | null
          proveedor_id: string
          tipo: string
          total: number
        }
        Insert: {
          creado_en?: string
          empresa_id: string
          estado?: string
          exento?: number
          fecha_emision: string
          folio: number
          id?: string
          iva?: number
          motivo_anulacion?: string | null
          neto?: number
          notas?: string | null
          orden_id?: string | null
          proveedor_id: string
          tipo: string
          total: number
        }
        Update: {
          creado_en?: string
          empresa_id?: string
          estado?: string
          exento?: number
          fecha_emision?: string
          folio?: number
          id?: string
          iva?: number
          motivo_anulacion?: string | null
          neto?: number
          notas?: string | null
          orden_id?: string | null
          proveedor_id?: string
          tipo?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "documentos_compra_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_compra_empresa_id_orden_id_fkey"
            columns: ["empresa_id", "orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_compra"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "documentos_compra_empresa_id_proveedor_id_fkey"
            columns: ["empresa_id", "proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["empresa_id", "id"]
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
            foreignKeyName: "documentos_venta_empresa_id_documento_referencia_id_fkey"
            columns: ["empresa_id", "documento_referencia_id"]
            isOneToOne: false
            referencedRelation: "libro_ventas"
            referencedColumns: ["empresa_id", "documento_id"]
          },
          {
            foreignKeyName: "documentos_venta_empresa_id_documento_referencia_id_fkey"
            columns: ["empresa_id", "documento_referencia_id"]
            isOneToOne: false
            referencedRelation: "saldos_documentos"
            referencedColumns: ["empresa_id", "documento_id"]
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
            foreignKeyName: "documentos_venta_lineas_empresa_id_documento_id_fkey"
            columns: ["empresa_id", "documento_id"]
            isOneToOne: false
            referencedRelation: "libro_ventas"
            referencedColumns: ["empresa_id", "documento_id"]
          },
          {
            foreignKeyName: "documentos_venta_lineas_empresa_id_documento_id_fkey"
            columns: ["empresa_id", "documento_id"]
            isOneToOne: false
            referencedRelation: "saldos_documentos"
            referencedColumns: ["empresa_id", "documento_id"]
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
          {
            foreignKeyName: "documentos_venta_lineas_empresa_id_producto_id_fkey"
            columns: ["empresa_id", "producto_id"]
            isOneToOne: false
            referencedRelation: "valorizacion_inventario"
            referencedColumns: ["empresa_id", "producto_id"]
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
          factor_volumetrico: number
          giro: string | null
          giro_emisor: string | null
          id: string
          modulo_contabilidad: boolean
          modulo_transporte: boolean
          mp_access_token_cifrado: string | null
          mp_webhook_secret_cifrado: string | null
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
          factor_volumetrico?: number
          giro?: string | null
          giro_emisor?: string | null
          id?: string
          modulo_contabilidad?: boolean
          modulo_transporte?: boolean
          mp_access_token_cifrado?: string | null
          mp_webhook_secret_cifrado?: string | null
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
          factor_volumetrico?: number
          giro?: string | null
          giro_emisor?: string | null
          id?: string
          modulo_contabilidad?: boolean
          modulo_transporte?: boolean
          mp_access_token_cifrado?: string | null
          mp_webhook_secret_cifrado?: string | null
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
      gastos_vehiculo: {
        Row: {
          categoria: string
          creado_en: string
          empresa_id: string
          fecha: string
          id: string
          monto: number
          notas: string | null
          vehiculo_id: string
        }
        Insert: {
          categoria: string
          creado_en?: string
          empresa_id: string
          fecha: string
          id?: string
          monto: number
          notas?: string | null
          vehiculo_id: string
        }
        Update: {
          categoria?: string
          creado_en?: string
          empresa_id?: string
          fecha?: string
          id?: string
          monto?: number
          notas?: string | null
          vehiculo_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gastos_vehiculo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gastos_vehiculo_empresa_id_vehiculo_id_fkey"
            columns: ["empresa_id", "vehiculo_id"]
            isOneToOne: false
            referencedRelation: "vehiculos"
            referencedColumns: ["empresa_id", "id"]
          },
        ]
      }
      links_pago: {
        Row: {
          cliente_id: string
          creado_en: string
          empresa_id: string
          estado: string
          id: string
          monto: number
          mp_payment_id: string | null
          origen_id: string
          origen_tipo: string
          preferencia_id: string
          url: string
        }
        Insert: {
          cliente_id: string
          creado_en?: string
          empresa_id: string
          estado?: string
          id?: string
          monto: number
          mp_payment_id?: string | null
          origen_id: string
          origen_tipo: string
          preferencia_id: string
          url: string
        }
        Update: {
          cliente_id?: string
          creado_en?: string
          empresa_id?: string
          estado?: string
          id?: string
          monto?: number
          mp_payment_id?: string | null
          origen_id?: string
          origen_tipo?: string
          preferencia_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "links_pago_empresa_id_cliente_id_fkey"
            columns: ["empresa_id", "cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "links_pago_empresa_id_fkey"
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
      movimientos_stock: {
        Row: {
          bodega_id: string
          cantidad: number
          creado_en: string
          empresa_id: string
          id: string
          motivo: string | null
          producto_id: string
          proveedor_id: string | null
          referencia_documento_id: string | null
          referencia_recepcion_id: string | null
          tipo: string
        }
        Insert: {
          bodega_id: string
          cantidad: number
          creado_en?: string
          empresa_id: string
          id?: string
          motivo?: string | null
          producto_id: string
          proveedor_id?: string | null
          referencia_documento_id?: string | null
          referencia_recepcion_id?: string | null
          tipo: string
        }
        Update: {
          bodega_id?: string
          cantidad?: number
          creado_en?: string
          empresa_id?: string
          id?: string
          motivo?: string | null
          producto_id?: string
          proveedor_id?: string | null
          referencia_documento_id?: string | null
          referencia_recepcion_id?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "movimientos_stock_empresa_id_bodega_id_fkey"
            columns: ["empresa_id", "bodega_id"]
            isOneToOne: false
            referencedRelation: "bodegas"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "movimientos_stock_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_stock_empresa_id_producto_id_fkey"
            columns: ["empresa_id", "producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "movimientos_stock_empresa_id_producto_id_fkey"
            columns: ["empresa_id", "producto_id"]
            isOneToOne: false
            referencedRelation: "valorizacion_inventario"
            referencedColumns: ["empresa_id", "producto_id"]
          },
          {
            foreignKeyName: "movimientos_stock_empresa_id_proveedor_id_fkey"
            columns: ["empresa_id", "proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "movimientos_stock_empresa_id_referencia_documento_id_fkey"
            columns: ["empresa_id", "referencia_documento_id"]
            isOneToOne: false
            referencedRelation: "documentos_venta"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "movimientos_stock_empresa_id_referencia_documento_id_fkey"
            columns: ["empresa_id", "referencia_documento_id"]
            isOneToOne: false
            referencedRelation: "libro_ventas"
            referencedColumns: ["empresa_id", "documento_id"]
          },
          {
            foreignKeyName: "movimientos_stock_empresa_id_referencia_documento_id_fkey"
            columns: ["empresa_id", "referencia_documento_id"]
            isOneToOne: false
            referencedRelation: "saldos_documentos"
            referencedColumns: ["empresa_id", "documento_id"]
          },
          {
            foreignKeyName: "movimientos_stock_recepcion_fk"
            columns: ["empresa_id", "referencia_recepcion_id"]
            isOneToOne: false
            referencedRelation: "recepciones"
            referencedColumns: ["empresa_id", "id"]
          },
        ]
      }
      ordenes_compra: {
        Row: {
          actualizado_en: string
          creado_en: string
          empresa_id: string
          estado: string
          id: string
          notas: string | null
          numero: number
          proveedor_id: string
        }
        Insert: {
          actualizado_en?: string
          creado_en?: string
          empresa_id: string
          estado?: string
          id?: string
          notas?: string | null
          numero: number
          proveedor_id: string
        }
        Update: {
          actualizado_en?: string
          creado_en?: string
          empresa_id?: string
          estado?: string
          id?: string
          notas?: string | null
          numero?: number
          proveedor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ordenes_compra_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_compra_empresa_id_proveedor_id_fkey"
            columns: ["empresa_id", "proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["empresa_id", "id"]
          },
        ]
      }
      ordenes_compra_lineas: {
        Row: {
          cantidad_pedida: number
          cantidad_recibida: number
          costo_unitario: number
          descripcion: string
          empresa_id: string
          id: string
          orden_id: string
          producto_id: string
        }
        Insert: {
          cantidad_pedida: number
          cantidad_recibida?: number
          costo_unitario: number
          descripcion: string
          empresa_id: string
          id?: string
          orden_id: string
          producto_id: string
        }
        Update: {
          cantidad_pedida?: number
          cantidad_recibida?: number
          costo_unitario?: number
          descripcion?: string
          empresa_id?: string
          id?: string
          orden_id?: string
          producto_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ordenes_compra_lineas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_compra_lineas_empresa_id_orden_id_fkey"
            columns: ["empresa_id", "orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_compra"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "ordenes_compra_lineas_empresa_id_producto_id_fkey"
            columns: ["empresa_id", "producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "ordenes_compra_lineas_empresa_id_producto_id_fkey"
            columns: ["empresa_id", "producto_id"]
            isOneToOne: false
            referencedRelation: "valorizacion_inventario"
            referencedColumns: ["empresa_id", "producto_id"]
          },
        ]
      }
      ordenes_entrega: {
        Row: {
          bultos: number
          cliente_id: string
          conductor_id: string | null
          creado_en: string
          destino_id: string
          docum: string | null
          documento_venta_id: string | null
          empresa_id: string
          estado: string
          fecha_ingreso: string
          id: string
          kilo_afecto: number
          kilos: number
          m3: number | null
          motivo_anulacion: string | null
          neto: number
          notas: string | null
          numero: number
          oc_cliente: string | null
          proforma_id: string | null
          vehiculo_id: string | null
        }
        Insert: {
          bultos: number
          cliente_id: string
          conductor_id?: string | null
          creado_en?: string
          destino_id: string
          docum?: string | null
          documento_venta_id?: string | null
          empresa_id: string
          estado?: string
          fecha_ingreso: string
          id?: string
          kilo_afecto: number
          kilos: number
          m3?: number | null
          motivo_anulacion?: string | null
          neto: number
          notas?: string | null
          numero: number
          oc_cliente?: string | null
          proforma_id?: string | null
          vehiculo_id?: string | null
        }
        Update: {
          bultos?: number
          cliente_id?: string
          conductor_id?: string | null
          creado_en?: string
          destino_id?: string
          docum?: string | null
          documento_venta_id?: string | null
          empresa_id?: string
          estado?: string
          fecha_ingreso?: string
          id?: string
          kilo_afecto?: number
          kilos?: number
          m3?: number | null
          motivo_anulacion?: string | null
          neto?: number
          notas?: string | null
          numero?: number
          oc_cliente?: string | null
          proforma_id?: string | null
          vehiculo_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ordenes_entrega_empresa_id_cliente_id_fkey"
            columns: ["empresa_id", "cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "ordenes_entrega_empresa_id_conductor_id_fkey"
            columns: ["empresa_id", "conductor_id"]
            isOneToOne: false
            referencedRelation: "conductores"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "ordenes_entrega_empresa_id_destino_id_fkey"
            columns: ["empresa_id", "destino_id"]
            isOneToOne: false
            referencedRelation: "destinos"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "ordenes_entrega_empresa_id_documento_venta_id_fkey"
            columns: ["empresa_id", "documento_venta_id"]
            isOneToOne: false
            referencedRelation: "documentos_venta"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "ordenes_entrega_empresa_id_documento_venta_id_fkey"
            columns: ["empresa_id", "documento_venta_id"]
            isOneToOne: false
            referencedRelation: "libro_ventas"
            referencedColumns: ["empresa_id", "documento_id"]
          },
          {
            foreignKeyName: "ordenes_entrega_empresa_id_documento_venta_id_fkey"
            columns: ["empresa_id", "documento_venta_id"]
            isOneToOne: false
            referencedRelation: "saldos_documentos"
            referencedColumns: ["empresa_id", "documento_id"]
          },
          {
            foreignKeyName: "ordenes_entrega_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_entrega_empresa_id_proforma_id_fkey"
            columns: ["empresa_id", "proforma_id"]
            isOneToOne: false
            referencedRelation: "proformas"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "ordenes_entrega_empresa_id_vehiculo_id_fkey"
            columns: ["empresa_id", "vehiculo_id"]
            isOneToOne: false
            referencedRelation: "vehiculos"
            referencedColumns: ["empresa_id", "id"]
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
      pagos: {
        Row: {
          anticipo_id: string | null
          cliente_id: string
          creado_en: string
          empresa_id: string
          estado: string
          fecha: string
          id: string
          metodo: string
          monto: number
          motivo_anulacion: string | null
          mp_payment_id: string | null
          notas: string | null
          referencia: string | null
        }
        Insert: {
          anticipo_id?: string | null
          cliente_id: string
          creado_en?: string
          empresa_id: string
          estado?: string
          fecha?: string
          id?: string
          metodo: string
          monto: number
          motivo_anulacion?: string | null
          mp_payment_id?: string | null
          notas?: string | null
          referencia?: string | null
        }
        Update: {
          anticipo_id?: string | null
          cliente_id?: string
          creado_en?: string
          empresa_id?: string
          estado?: string
          fecha?: string
          id?: string
          metodo?: string
          monto?: number
          motivo_anulacion?: string | null
          mp_payment_id?: string | null
          notas?: string | null
          referencia?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pagos_anticipo_fk"
            columns: ["empresa_id", "anticipo_id"]
            isOneToOne: false
            referencedRelation: "anticipos"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "pagos_empresa_id_cliente_id_fkey"
            columns: ["empresa_id", "cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "pagos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      pagos_aplicaciones: {
        Row: {
          documento_id: string
          empresa_id: string
          id: string
          monto: number
          pago_id: string
        }
        Insert: {
          documento_id: string
          empresa_id: string
          id?: string
          monto: number
          pago_id: string
        }
        Update: {
          documento_id?: string
          empresa_id?: string
          id?: string
          monto?: number
          pago_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pagos_aplicaciones_empresa_id_documento_id_fkey"
            columns: ["empresa_id", "documento_id"]
            isOneToOne: false
            referencedRelation: "documentos_venta"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "pagos_aplicaciones_empresa_id_documento_id_fkey"
            columns: ["empresa_id", "documento_id"]
            isOneToOne: false
            referencedRelation: "libro_ventas"
            referencedColumns: ["empresa_id", "documento_id"]
          },
          {
            foreignKeyName: "pagos_aplicaciones_empresa_id_documento_id_fkey"
            columns: ["empresa_id", "documento_id"]
            isOneToOne: false
            referencedRelation: "saldos_documentos"
            referencedColumns: ["empresa_id", "documento_id"]
          },
          {
            foreignKeyName: "pagos_aplicaciones_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagos_aplicaciones_empresa_id_pago_id_fkey"
            columns: ["empresa_id", "pago_id"]
            isOneToOne: false
            referencedRelation: "pagos"
            referencedColumns: ["empresa_id", "id"]
          },
        ]
      }
      pagos_proveedor: {
        Row: {
          creado_en: string
          empresa_id: string
          estado: string
          fecha: string
          id: string
          metodo: string
          monto: number
          motivo_anulacion: string | null
          notas: string | null
          proveedor_id: string
          referencia: string | null
        }
        Insert: {
          creado_en?: string
          empresa_id: string
          estado?: string
          fecha?: string
          id?: string
          metodo: string
          monto: number
          motivo_anulacion?: string | null
          notas?: string | null
          proveedor_id: string
          referencia?: string | null
        }
        Update: {
          creado_en?: string
          empresa_id?: string
          estado?: string
          fecha?: string
          id?: string
          metodo?: string
          monto?: number
          motivo_anulacion?: string | null
          notas?: string | null
          proveedor_id?: string
          referencia?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pagos_proveedor_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagos_proveedor_empresa_id_proveedor_id_fkey"
            columns: ["empresa_id", "proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["empresa_id", "id"]
          },
        ]
      }
      pagos_proveedor_aplicaciones: {
        Row: {
          documento_id: string
          empresa_id: string
          id: string
          monto: number
          pago_id: string
        }
        Insert: {
          documento_id: string
          empresa_id: string
          id?: string
          monto: number
          pago_id: string
        }
        Update: {
          documento_id?: string
          empresa_id?: string
          id?: string
          monto?: number
          pago_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pagos_proveedor_aplicaciones_empresa_id_documento_id_fkey"
            columns: ["empresa_id", "documento_id"]
            isOneToOne: false
            referencedRelation: "documentos_compra"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "pagos_proveedor_aplicaciones_empresa_id_documento_id_fkey"
            columns: ["empresa_id", "documento_id"]
            isOneToOne: false
            referencedRelation: "libro_compras"
            referencedColumns: ["empresa_id", "documento_id"]
          },
          {
            foreignKeyName: "pagos_proveedor_aplicaciones_empresa_id_documento_id_fkey"
            columns: ["empresa_id", "documento_id"]
            isOneToOne: false
            referencedRelation: "saldos_compras"
            referencedColumns: ["empresa_id", "documento_id"]
          },
          {
            foreignKeyName: "pagos_proveedor_aplicaciones_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagos_proveedor_aplicaciones_empresa_id_pago_id_fkey"
            columns: ["empresa_id", "pago_id"]
            isOneToOne: false
            referencedRelation: "pagos_proveedor"
            referencedColumns: ["empresa_id", "id"]
          },
        ]
      }
      pagos_suscripcion: {
        Row: {
          buy_order: string
          creado_en: string
          estado: string
          id: string
          monto: number
          organizacion_id: string
          pagado_en: string | null
          pasarela: string
          plan_id: string
          referencia_externa: string | null
        }
        Insert: {
          buy_order: string
          creado_en?: string
          estado?: string
          id?: string
          monto: number
          organizacion_id: string
          pagado_en?: string | null
          pasarela: string
          plan_id: string
          referencia_externa?: string | null
        }
        Update: {
          buy_order?: string
          creado_en?: string
          estado?: string
          id?: string
          monto?: number
          organizacion_id?: string
          pagado_en?: string | null
          pasarela?: string
          plan_id?: string
          referencia_externa?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pagos_suscripcion_organizacion_id_fkey"
            columns: ["organizacion_id"]
            isOneToOne: false
            referencedRelation: "organizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagos_suscripcion_plan_id_fkey"
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
          stock_minimo: number
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
          stock_minimo?: number
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
          stock_minimo?: number
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
      proformas: {
        Row: {
          cliente_id: string
          creado_en: string
          documento_venta_id: string | null
          empresa_id: string
          estado: string
          fecha: string
          id: string
          iva: number
          motivo_rechazo: string | null
          neto: number
          notas: string | null
          numero: number
          total: number
        }
        Insert: {
          cliente_id: string
          creado_en?: string
          documento_venta_id?: string | null
          empresa_id: string
          estado?: string
          fecha?: string
          id?: string
          iva?: number
          motivo_rechazo?: string | null
          neto?: number
          notas?: string | null
          numero: number
          total?: number
        }
        Update: {
          cliente_id?: string
          creado_en?: string
          documento_venta_id?: string | null
          empresa_id?: string
          estado?: string
          fecha?: string
          id?: string
          iva?: number
          motivo_rechazo?: string | null
          neto?: number
          notas?: string | null
          numero?: number
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "proformas_empresa_id_cliente_id_fkey"
            columns: ["empresa_id", "cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "proformas_empresa_id_documento_venta_id_fkey"
            columns: ["empresa_id", "documento_venta_id"]
            isOneToOne: false
            referencedRelation: "documentos_venta"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "proformas_empresa_id_documento_venta_id_fkey"
            columns: ["empresa_id", "documento_venta_id"]
            isOneToOne: false
            referencedRelation: "libro_ventas"
            referencedColumns: ["empresa_id", "documento_id"]
          },
          {
            foreignKeyName: "proformas_empresa_id_documento_venta_id_fkey"
            columns: ["empresa_id", "documento_venta_id"]
            isOneToOne: false
            referencedRelation: "saldos_documentos"
            referencedColumns: ["empresa_id", "documento_id"]
          },
          {
            foreignKeyName: "proformas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      proveedores: {
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
            foreignKeyName: "proveedores_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      recepciones: {
        Row: {
          bodega_id: string
          creado_en: string
          empresa_id: string
          id: string
          notas: string | null
          orden_id: string
        }
        Insert: {
          bodega_id: string
          creado_en?: string
          empresa_id: string
          id?: string
          notas?: string | null
          orden_id: string
        }
        Update: {
          bodega_id?: string
          creado_en?: string
          empresa_id?: string
          id?: string
          notas?: string | null
          orden_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recepciones_empresa_id_bodega_id_fkey"
            columns: ["empresa_id", "bodega_id"]
            isOneToOne: false
            referencedRelation: "bodegas"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "recepciones_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recepciones_empresa_id_orden_id_fkey"
            columns: ["empresa_id", "orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes_compra"
            referencedColumns: ["empresa_id", "id"]
          },
        ]
      }
      recepciones_lineas: {
        Row: {
          cantidad: number
          costo_unitario: number
          empresa_id: string
          id: string
          orden_linea_id: string
          producto_id: string
          recepcion_id: string
        }
        Insert: {
          cantidad: number
          costo_unitario: number
          empresa_id: string
          id?: string
          orden_linea_id: string
          producto_id: string
          recepcion_id: string
        }
        Update: {
          cantidad?: number
          costo_unitario?: number
          empresa_id?: string
          id?: string
          orden_linea_id?: string
          producto_id?: string
          recepcion_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recepciones_lineas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recepciones_lineas_empresa_id_orden_linea_id_fkey"
            columns: ["empresa_id", "orden_linea_id"]
            isOneToOne: false
            referencedRelation: "ordenes_compra_lineas"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "recepciones_lineas_empresa_id_producto_id_fkey"
            columns: ["empresa_id", "producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "recepciones_lineas_empresa_id_producto_id_fkey"
            columns: ["empresa_id", "producto_id"]
            isOneToOne: false
            referencedRelation: "valorizacion_inventario"
            referencedColumns: ["empresa_id", "producto_id"]
          },
          {
            foreignKeyName: "recepciones_lineas_empresa_id_recepcion_id_fkey"
            columns: ["empresa_id", "recepcion_id"]
            isOneToOne: false
            referencedRelation: "recepciones"
            referencedColumns: ["empresa_id", "id"]
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
            isOneToOne: true
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
      vehiculos: {
        Row: {
          activo: boolean
          capacidad_kg: number | null
          creado_en: string
          descripcion: string | null
          empresa_id: string
          id: string
          patente: string
        }
        Insert: {
          activo?: boolean
          capacidad_kg?: number | null
          creado_en?: string
          descripcion?: string | null
          empresa_id: string
          id?: string
          patente: string
        }
        Update: {
          activo?: boolean
          capacidad_kg?: number | null
          creado_en?: string
          descripcion?: string | null
          empresa_id?: string
          id?: string
          patente?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehiculos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      libro_compras: {
        Row: {
          documento_id: string | null
          empresa_id: string | null
          exento: number | null
          fecha: string | null
          folio: number | null
          iva: number | null
          neto: number | null
          razon_social_proveedor: string | null
          rut_proveedor: string | null
          tipo: string | null
          total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "documentos_compra_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      libro_ventas: {
        Row: {
          documento_id: string | null
          empresa_id: string | null
          exento: number | null
          fecha: string | null
          folio: number | null
          iva: number | null
          neto: number | null
          razon_social_cliente: string | null
          rut_cliente: string | null
          tipo: string | null
          total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "documentos_venta_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      rentabilidad_vehiculo: {
        Row: {
          combustible: number | null
          empresa_id: string | null
          gastos: number | null
          ingresos: number | null
          mes: string | null
          vehiculo_id: string | null
        }
        Relationships: []
      }
      saldos_compras: {
        Row: {
          documento_id: string | null
          empresa_id: string | null
          fecha_emision: string | null
          fecha_vencimiento: string | null
          folio: number | null
          pagado: number | null
          proveedor_id: string | null
          proveedor_razon_social: string | null
          saldo: number | null
          tipo: string | null
          total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "documentos_compra_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_compra_empresa_id_proveedor_id_fkey"
            columns: ["empresa_id", "proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["empresa_id", "id"]
          },
        ]
      }
      saldos_documentos: {
        Row: {
          cliente_id: string | null
          cliente_razon_social: string | null
          documento_id: string | null
          emitido_en: string | null
          empresa_id: string | null
          fecha_vencimiento: string | null
          folio: number | null
          notas_credito: number | null
          pagado: number | null
          saldo: number | null
          tipo: string | null
          total: number | null
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
            foreignKeyName: "documentos_venta_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_actual: {
        Row: {
          bodega_id: string | null
          cantidad: number | null
          empresa_id: string | null
          producto_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "movimientos_stock_empresa_id_bodega_id_fkey"
            columns: ["empresa_id", "bodega_id"]
            isOneToOne: false
            referencedRelation: "bodegas"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "movimientos_stock_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_stock_empresa_id_producto_id_fkey"
            columns: ["empresa_id", "producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "movimientos_stock_empresa_id_producto_id_fkey"
            columns: ["empresa_id", "producto_id"]
            isOneToOne: false
            referencedRelation: "valorizacion_inventario"
            referencedColumns: ["empresa_id", "producto_id"]
          },
        ]
      }
      valorizacion_inventario: {
        Row: {
          costo_unitario: number | null
          empresa_id: string | null
          nombre: string | null
          producto_id: string | null
          sku: string | null
          stock: number | null
          valor: number | null
        }
        Relationships: [
          {
            foreignKeyName: "productos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      ventas_diarias: {
        Row: {
          documentos: number | null
          empresa_id: string | null
          fecha: string | null
          iva: number | null
          neto: number | null
          total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "documentos_venta_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      ventas_por_producto: {
        Row: {
          cantidad: number | null
          descripcion: string | null
          empresa_id: string | null
          fecha: string | null
          producto_id: string | null
          subtotal: number | null
        }
        Relationships: [
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
          {
            foreignKeyName: "documentos_venta_lineas_empresa_id_producto_id_fkey"
            columns: ["empresa_id", "producto_id"]
            isOneToOne: false
            referencedRelation: "valorizacion_inventario"
            referencedColumns: ["empresa_id", "producto_id"]
          },
        ]
      }
    }
    Functions: {
      abortar_pago_suscripcion: { Args: { p_pago: string }; Returns: undefined }
      activar_contabilidad: { Args: { p_empresa: string }; Returns: undefined }
      anular_documento_compra: {
        Args: { p_documento: string; p_empresa: string; p_motivo: string }
        Returns: undefined
      }
      anular_estado_pago: {
        Args: { p_documento: string; p_empresa: string }
        Returns: undefined
      }
      anular_orden_entrega: {
        Args: { p_empresa: string; p_motivo: string; p_orden: string }
        Returns: undefined
      }
      anular_pago: {
        Args: { p_empresa: string; p_motivo: string; p_pago: string }
        Returns: undefined
      }
      anular_pago_proveedor: {
        Args: { p_empresa: string; p_motivo: string; p_pago: string }
        Returns: undefined
      }
      aplicar_anticipo: {
        Args: { p_documento: string; p_empresa: string }
        Returns: string
      }
      aplicar_anticipo_manual: {
        Args: { p_anticipo: string; p_documento: string; p_empresa: string }
        Returns: string
      }
      asignar_despacho: {
        Args: {
          p_conductor: string
          p_empresa: string
          p_orden: string
          p_vehiculo: string
        }
        Returns: undefined
      }
      bodega_por_defecto: { Args: { p_empresa: string }; Returns: string }
      cambiar_estado_cotizacion: {
        Args: {
          p_cotizacion: string
          p_empresa: string
          p_estado: string
          p_motivo?: string
        }
        Returns: undefined
      }
      cambiar_estado_proforma: {
        Args: {
          p_empresa: string
          p_estado: string
          p_motivo?: string
          p_proforma: string
        }
        Returns: undefined
      }
      confirmar_pago_suscripcion: {
        Args: { p_monto: number; p_pago: string; p_referencia: string }
        Returns: string
      }
      contabilizar_documento: {
        Args: { p_empresa: string; p_origen: string; p_referencia: string }
        Returns: string
      }
      contabilizar_pendientes: { Args: { p_empresa: string }; Returns: Json }
      convertir_cotizacion: {
        Args: { p_cotizacion: string; p_empresa: string }
        Returns: string
      }
      crear_asiento: {
        Args: {
          p_empresa: string
          p_fecha: string
          p_glosa: string
          p_lineas: Json
        }
        Returns: string
      }
      crear_cotizacion: {
        Args: {
          p_cliente: string
          p_empresa: string
          p_lineas: Json
          p_notas: string
          p_validez: string
        }
        Returns: string
      }
      crear_documento_venta: {
        Args: {
          p_cliente: string
          p_empresa: string
          p_lineas: Json
          p_tipo: string
        }
        Returns: string
      }
      crear_link_pago: {
        Args: {
          p_empresa: string
          p_id: string
          p_monto: number
          p_origen: string
          p_origen_tipo: string
          p_preferencia: string
          p_url: string
        }
        Returns: string
      }
      crear_orden_compra: {
        Args: {
          p_empresa: string
          p_lineas: Json
          p_notas: string
          p_proveedor: string
        }
        Returns: string
      }
      crear_orden_entrega: {
        Args: {
          p_bultos: number
          p_cliente: string
          p_conductor: string
          p_destino: string
          p_docum: string
          p_empresa: string
          p_fecha: string
          p_kilos: number
          p_m3: number
          p_neto: number
          p_notas: string
          p_oc: string
          p_vehiculo: string
        }
        Returns: string
      }
      crear_pago_suscripcion: {
        Args: { p_organizacion: string; p_pasarela: string }
        Returns: Json
      }
      crear_proforma: {
        Args: {
          p_cliente: string
          p_empresa: string
          p_notas: string
          p_ordenes: string[]
        }
        Returns: string
      }
      desactivar_contabilidad: {
        Args: { p_empresa: string }
        Returns: undefined
      }
      facturar_proforma: {
        Args: { p_empresa: string; p_proforma: string }
        Returns: string
      }
      guardar_cuenta: {
        Args: {
          p_acepta_movimientos: boolean
          p_activa: boolean
          p_codigo: string
          p_empresa: string
          p_id: string
          p_nombre: string
          p_tipo: string
        }
        Returns: string
      }
      registrar_ajuste: {
        Args: {
          p_bodega: string
          p_cantidad: number
          p_empresa: string
          p_motivo: string
          p_producto: string
        }
        Returns: string
      }
      registrar_anticipo_mp: {
        Args: {
          p_empresa: string
          p_link: string
          p_monto: number
          p_mp_payment_id: string
          p_origen: string
          p_origen_tipo: string
        }
        Returns: undefined
      }
      registrar_entrada: {
        Args: {
          p_bodega: string
          p_cantidad: number
          p_empresa: string
          p_motivo: string
          p_producto: string
          p_proveedor: string
        }
        Returns: string
      }
      registrar_movimientos_documento: {
        Args: {
          p_documento: string
          p_empresa: string
          p_lineas: Json
          p_motivo: string
          p_signo: number
        }
        Returns: undefined
      }
      registrar_organizacion: {
        Args: { p_razon_social: string; p_rut: string }
        Returns: string
      }
      registrar_pago: {
        Args: {
          p_aplicaciones: Json
          p_cliente: string
          p_empresa: string
          p_fecha: string
          p_metodo: string
          p_monto: number
          p_notas: string
          p_referencia: string
        }
        Returns: string
      }
      registrar_pago_mp: {
        Args: {
          p_documento: string
          p_empresa: string
          p_link: string
          p_monto: number
          p_mp_payment_id: string
        }
        Returns: undefined
      }
      registrar_pago_proveedor: {
        Args: {
          p_aplicaciones: Json
          p_empresa: string
          p_fecha: string
          p_metodo: string
          p_monto: number
          p_notas: string
          p_proveedor: string
          p_referencia: string
        }
        Returns: string
      }
      registrar_recepcion: {
        Args: {
          p_bodega: string
          p_empresa: string
          p_lineas: Json
          p_notas: string
          p_orden: string
        }
        Returns: string
      }
      registrar_traslado: {
        Args: {
          p_cantidad: number
          p_destino: string
          p_empresa: string
          p_origen: string
          p_producto: string
        }
        Returns: undefined
      }
      revertir_asiento: {
        Args: { p_asiento: string; p_empresa: string; p_glosa: string }
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

