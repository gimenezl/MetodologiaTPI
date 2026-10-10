# Contratos de vista compartidos

Tipos que cruzan la frontera entre **contenedor** y **vista** (ver [separación de responsabilidades](./separacion-contenedor-presentacional.md)). Son **contratos documentados en TypeScript**: describen la forma de los datos que una vista recibe, no código productivo. No importan Supabase, `next/*` ni módulos de servidor (restricción de EPT-98 §9).

## Reglas de los DTO de vista

1. **Importes**: enteros en centavos (`Centavos`). Los calculó el servidor; ninguna vista suma, resta ni redondea para obtener un importe definitivo (EPT-97 §7, EPT-98 §3). Formatear para mostrar (`ARS 63.606,65`) sí es responsabilidad de la vista.
2. **Fechas**: fecha civil de Argentina `aaaa-mm-dd`, sin hora ni zona. La vista solo la reordena a `dd/mm/aaaa`.
3. **Estados**: llegan **ya derivados** por el servidor (`v_facturas_estado`, EPT-98 §2). La vista no decide si una factura está Vencida; el prototipo de EPT-96 lo derivaba en `reglas.mjs` solo para ilustrar la regla.
4. **Identificadores**: opacos. La vista no los interpreta ni los muestra.
5. **Texto de dominio** (período, concepto, nombre del hijo) llega ya redactado en español; **texto fijo de interfaz** («Vencimiento», «Saldo», «Reintentar») vive en la vista.
6. **Errores**: la vista recibe un mensaje en español ya traducido desde el catálogo de errores del dominio (EPT-98 §6). Nunca mensajes de PostgREST ni códigos SQLSTATE.

## Tipos

```ts
/** Importe en ARS, en centavos enteros, tal como lo calculó el servidor. */
export type Centavos = number
/** Fecha civil de Argentina `aaaa-mm-dd`, sin hora ni zona. */
export type FechaCivil = string

export type EstadoFactura = 'pendiente' | 'parcial' | 'pagada' | 'vencida'
export type EstadoItem = 'pagado' | 'verificacion' | 'pendiente'
export type EstadoPago = 'aprobado' | 'pendiente' | 'rechazado'
export type ConceptoItem = 'cuota' | 'deporte' | 'transporte' | 'comedor'

/** Estado de una lectura remota, resuelto por el contenedor. «Vacío» lo deriva la vista de una lista sin elementos. */
export type EstadoRemoto<T> =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string; reintentable: boolean }
  | { tipo: 'listo'; datos: T }

export interface HijoVista {
  id: string
  nombre: string
}

export interface ItemVista {
  id: string
  concepto: ConceptoItem
  /** Texto de dominio, por ejemplo «Deporte · Fútbol». */
  etiqueta: string
  importe: Centavos
  estado: EstadoItem
}

export interface CuotaVista {
  id: string
  /** Texto de dominio, por ejemplo «Septiembre 2026». */
  periodo: string
  vencimiento: FechaCivil
  importe: Centavos
  saldo: Centavos
  estado: EstadoFactura
}

export interface FacturaVista extends CuotaVista {
  items: ItemVista[]
  pagado: Centavos
}

export interface ArchivoVista {
  id: string
  nombre: string
  bytes: number
  /** Mensaje del contenedor cuando el archivo no cumple tipo o tamaño. */
  error?: string
}

export interface PagoVista {
  id: string
  /** `null` mientras el pago no tiene comprobante con fecha de transferencia. */
  fechaTransferencia: FechaCivil | null
  estado: EstadoPago
  /** Descripciones de los ítems incluidos, por ejemplo «Septiembre 2026 · Comedor». */
  conceptos: string[]
  totalItems: Centavos
  importeInformado: Centavos | null
  numeroOperacion: string | null
  cantidadComprobantes: number
  /** El permiso sobre el original es **por pago** (quien lo cargó y Dirección). Origen a confirmar (README A4). */
  puedeAbrirOriginal: boolean
}

/**
 * Qué puede hacer quien mira la pantalla. Lo interpreta el contenedor a partir de la respuesta
 * autorizada del servidor (rol, vínculo y cargador). No sustituye RLS: una acción no permitida
 * debe fallar igualmente en el servidor.
 */
export interface CapacidadesPago {
  puedeSeleccionarItems: boolean
  puedeCargarComprobante: boolean
}

/** Callback sin argumentos que la vista invoca y cuyo destino conoce solo el contenedor. */
export type Accion = () => void
```

## Lo que un tipo de vista no puede contener

| Prohibido en un DTO de vista | Motivo |
|---|---|
| Tokens de sesión, JWT, claves, rutas de Storage, URL firmadas | La vista no conoce secretos ni archivos privados |
| Identificadores de rol «crudos» para decidir permisos | Los permisos llegan como `CapacidadesPago` |
| Importes en `number` con decimales o `string` sin normalizar | Evita aritmética de punto flotante en el dispositivo |
| Objetos de tabla o fila de Supabase | Acopla la vista al esquema; el adaptador del contenedor los transforma |
