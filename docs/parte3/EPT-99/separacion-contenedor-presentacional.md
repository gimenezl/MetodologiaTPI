# Separación contenedor / presentacional

Aplica el patrón «Contenedor – Presentacional» de la arquitectura aprobada (EPT-97 §5, PDF p. 8) a la futura aplicación Expo/React Native. Esta separación es **organización de código y de responsabilidades**: no reemplaza la autorización del servidor ni RLS (EPT-97 §7, EPT-98 §7). No modifica API, base de datos, migraciones ni permisos.

## Regla en una frase

> La vista **pinta** lo que recibe y **avisa** lo que el usuario hizo; el contenedor **obtiene**, **adapta**, **decide** y **ejecuta**.

## Responsabilidades

| | Presentacional (vista) | Contenedor |
|---|---|---|
| Entrada | Props ya preparadas ([`contratos-vista.md`](./contratos-vista.md)) y callbacks | Parámetros de ruta, sesión, hijo elegido |
| Datos | Ninguna consulta | Consulta vistas y RPC (EPT-98), adapta DTO a tipos de vista |
| Estado | Solo efímero de interacción (foco, presionado). Los campos son controlados | Estado remoto (`cargando`/`error`/`listo`), selección, borrador, resultado incierto |
| Permisos | Respeta booleanos (`CapacidadesPago`, presencia de callbacks) | Interpreta rol, vínculo y cargador a partir de la respuesta autorizada |
| Importes | Formatea centavos para mostrar | Entrega los importes que calculó el servidor; no inventa totales definitivos |
| Navegación | Emite `onPress`/`onCambiarHijo` | Resuelve rutas y parámetros (Expo Router, EPT-102) |
| Errores | Muestra el mensaje en español recibido | Traduce códigos de dominio (EPT-98 §6) y decide si es reintentable |
| Pruebas | Se prueba con props fijas y capturas | Se prueba con servicios simulados y con la API real en EPT-102 |

## Dependencias

| Capa | Puede importar | No puede importar |
|---|---|---|
| Vista | `react`, `react-native`, tokens, otras vistas y componentes del catálogo, funciones puras de formato | `@supabase/supabase-js`, clientes HTTP, `fetch`, almacenamiento seguro, `expo-router`, navegación, módulos de sesión o de Storage, `next/*`, DOM, `service_role` |
| Contenedor | Servicios de datos, hooks de sesión y de navegación, adaptadores, esquemas Zod compartidos, la vista | Estilos propios: el aspecto vive en la vista |
| Adaptador | Tipos de transporte y tipos de vista | React |

Restricciones de EPT-98 §9 que se respetan: sin `next/headers`, sin cliente administrativo, sin DOM ni módulos de servidor en el dispositivo; sólo DTO, esquemas Zod, códigos de error y reglas puras compartidas.

## Qué pasa con las reglas del prototipo (`reglas.mjs`, EPT-96)

El prototipo concentra reglas para **ilustrar** el contrato. En la aplicación real cada una tiene dueño:

| Regla del prototipo | Dueño en producción | Qué recibe la vista |
|---|---|---|
| `estadoFactura` (Vencida prevalece; Pagada con saldo cero) | Servidor (`v_facturas_estado`, EPT-98 §2) | `EstadoFactura` ya derivado |
| `saldoFactura`, `importeFactura`, `deudaTotal` | Servidor / base de datos (importes calculados en servidor, `NUMERIC(12,2)`) | `Centavos` |
| `totalSeleccion` (solo ítems pendientes, completos, del mismo hijo) | Servidor al registrar (`registrar_pago`); el contenedor puede anticiparlo como cifra provisional para habilitar la acción (README A2) | Booleanos `seleccionable` y un `total` |
| `puedeVerHijo`, `puedeOperar`, `puedeVerOriginal` | RLS y Storage; el contenedor lo interpreta | `CapacidadesPago` |
| `validarArchivo`, `validarComprobante` | Esquemas Zod compartidos en el contenedor; la base es la autoridad | `archivo.error`, `errores` por campo |
| Orden de la lista por estado | Contenedor | Lista ya ordenada |
| `formatoArs`, `formatoFecha` | Vista (funciones puras de presentación) | — |

Tres supuestos del prototipo **no** se convierten en reglas aquí: formato del número de operación, fecha de transferencia sin restricción de futuro y deuda filtrada por vencimiento. Ver [README](./README.md#supuestos-y-puntos-abiertos).

## Mapa de pantallas: contenedor → vista → catálogo

Los nombres de vistas y RPC son **propuestos**: EPT-98 aclara que sus nombres se confirman al implementar. Las pantallas y sus rutas provienen de [`mapa-navegacion.md`](../EPT-96/mapa-navegacion.md) (EPT-96).

| Pantalla (EPT-95 / EPT-96) | Contenedor propuesto | Vista propuesta | Piezas del catálogo | Lecturas / escrituras (EPT-98) |
|---|---|---|---|---|
| Selector de hijo (M02, V06) | `SelectorDeHijoContenedor` | `SelectorDeHijoVista` | `Tarjeta`, `InsigniaEstado`, `FilaClaveValor`, `Importe`, `Aviso` | Vínculos y estado de facturas por hijo |
| **Cuotas** (M03, V07–V13, V26) | `CuotasContenedor` | `CuotasVista` | `ContextoHijo`, `TarjetaCuota`, `EstadoPantalla`, `Importe`, `Boton` | Lectura: `v_facturas_estado` por hijo |
| **Detalle de factura** (M04, V14) | `FacturaContenedor` | `DetalleDeFacturaVista` | `ContextoHijo`, `Tarjeta`, `ListaFilas`, `FilaItem`, `InsigniaEstado`, `Importe`, `Aviso`, `Boton` | Lectura: factura e ítems (`v_deuda_por_item` filtrado; objeto a confirmar) |
| **Selección y pago** (M05, V15, V16) | `SeleccionDePagoContenedor` | `SeleccionDePagoVista` | `ContextoHijo`, `Tarjeta`, `ListaFilas`, `FilaSeleccionable`, `ResumenTotal`, `Aviso`, `Boton` | Lectura: ítems; escritura: RPC `registrar_pago(p_item_ids)` → `pago_id`, `total_calculado` |
| **Comprobantes** — carga (M06, V17–V19, V25) | `ComprobanteContenedor` | `FormularioComprobanteVista` | `ContextoHijo`, `Formulario`, `CampoTexto`, `FilaArchivo`, `ListaFilas`, `Aviso`, `Boton` | Storage privado + RPC `adjuntar_comprobante(...)` |
| **Comprobantes** — registro (V20, V21) | `PagosContenedor` | `PagosVista` | `ContextoHijo`, `TarjetaPago`, `Aviso`, `EstadoPantalla` | Lectura: `v_pagos_detalle`, `v_comprobantes_registro` (sin ruta de archivo); original por URL firmada bajo RLS |
| Período (M07, V22) | `PeriodoContenedor` | `PeriodoVista` | `ContextoHijo`, `Formulario`, `CampoTexto`, `TarjetaPago`, `FilaClaveValor` | `v_facturas_estado` + `v_comprobantes_registro` |
| Deuda por ítem (M08, V23) | `DeudaContenedor` | `DeudaVista` | `ContextoHijo`, `Formulario`, `CampoTexto`, `ResumenTotal`, `Tarjeta`, `FilaItem` | `v_deuda_por_item` |
| Inscripciones (M09, V24) | `InscripcionesContenedor` | `InscripcionesVista` | `ContextoHijo`, `Tarjeta`, `FilaClaveValor` | RPC `consultar_inscripciones_hijo(p_hijo_id)` |
| Ingreso y estados de cuenta (M01, V01–V05) | `IngresoContenedor` | `IngresoVista` | `Formulario`, `CampoTexto`, `Boton`, `Aviso` | Supabase Auth; bloqueo y canal web por contrato |

## Ciclo de vida de un envío de comprobante (contenedor)

Los estados pertenecen al contenedor; la vista solo recibe el estado actual.

```text
borrador ──enviar──▶ enviando ──ok──▶ enviado
                         │
                         └─incierto─▶ incierto ──revisar estado──▶ recibido   (no reintentar)
                                                        └──────────▶ no-recibido ──reintento único──▶ enviando
```

- Mientras `enviando`, el contenedor ignora toques repetidos y la vista muestra `cargando` en el botón.
- Un resultado `incierto` obliga a **releer el estado** antes de ofrecer un reintento (EPT-98 §6; EPT-95 V19). El comprobante enviado queda «pendiente de verificación»: no aprueba el pago ni reduce el saldo.

## Ejemplo: cuotas, de punta a punta

```tsx
import type { ReactElement } from 'react'

/** Servicio de datos. Devuelve DTO ya adaptado a `CuotaVista`; el adaptador vive dentro del servicio. */
declare function useCuotasDelHijo(hijoId: string, pestana: 'pendientes' | 'pagadas'): {
  estado: EstadoRemoto<{ cuotas: CuotaVista[]; saldoTotal: Centavos }>
  recargar: () => void
}

declare function useNavegacionCuotas(): {
  abrirFactura: (cuotaId: string) => void
}

export interface CuotasContenedorProps {
  hijoId: string
  pestana: 'pendientes' | 'pagadas'
}

/** Contenedor: obtiene, adapta y entrega a la vista. No contiene estilos. */
export function CuotasContenedor({ hijoId, pestana }: CuotasContenedorProps): ReactElement {
  const { estado, recargar } = useCuotasDelHijo(hijoId, pestana)
  const { abrirFactura } = useNavegacionCuotas()
  return <CuotasVista estado={estado} pestana={pestana} onAbrirCuota={abrirFactura} onReintentar={recargar} />
}
```

`CuotasVista` es la definida en [`06-avisos-y-estados.md`](./componentes/06-avisos-y-estados.md): no importa servicios ni navegación y se puede mostrar con datos fijos en una captura o prueba.

## Lo que esta separación no garantiza

- **No es seguridad.** Ocultar un botón no impide la llamada: RLS y las guardas dentro de cada RPC siguen siendo la barrera. Un intento no autorizado debe fallar en el servidor aunque la vista no lo ofrezca.
- **No prueba ejecución nativa.** Es un contrato de código; la ejecución en Android e iOS se verifica con la app Expo (EPT-102).
