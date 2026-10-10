# `Aviso` y `EstadoPantalla`

Familia: **avisos y estados de pantalla** (complementaria; soporta los estados institucionales de carga, vacío y error). Tipos compartidos: [`contratos-vista.md`](../contratos-vista.md). Tokens: [`tokens.md`](../tokens.md).

## Propósito y escenarios

| Pieza | Para qué | Reutilización demostrada (`pantallas.mjs`) |
|---|---|---|
| `Aviso` | Mensaje en línea, no modal: información, advertencia, error o confirmación | 24 usos de `alerta()` |
| `EstadoPantalla` | Resultado de una lectura remota: cargando, vacío o error con reintento | Cuotas (V10, V11, V12) y registro de pagos (`comprobantes`) |

Escenarios cubiertos por `Aviso`: credenciales inválidas (mensaje genérico), cuenta bloqueada, sesión expirada, datos bancarios no configurados, pago pendiente de verificación, original no disponible, resultado incierto, importe distinto del total, solo consulta (estudiante), canal web.

## Referencias visuales

| Uso | Lámina |
|---|---|
| Informativo | [M01](../../EPT-95/disenos/mockups/M01-login.png) (canal web), [M05](../../EPT-95/disenos/mockups/M05-seleccion-y-pago.png) (banco no configurado), [V06](../../EPT-95/disenos/variantes/V06-selector-sin-vinculos.png) (sin vínculos), [V16](../../EPT-95/disenos/variantes/V16-pago-registrado.png), [V21](../../EPT-95/disenos/variantes/V21-comprobantes-estudiante.png) |
| Advertencia | [V04](../../EPT-95/disenos/variantes/V04-login-sesion-expirada.png), [V19](../../EPT-95/disenos/variantes/V19-comprobante-error-incierto.png) |
| Error | [V02](../../EPT-95/disenos/variantes/V02-login-credenciales-invalidas.png), [V03](../../EPT-95/disenos/variantes/V03-login-cuenta-bloqueada.png), [V12](../../EPT-95/disenos/variantes/V12-cuotas-error-conexion.png), [V15](../../EPT-95/disenos/variantes/V15-seleccion-validacion.png) |
| `EstadoPantalla` cargando | [V10](../../EPT-95/disenos/variantes/V10-cuotas-carga.png) |
| `EstadoPantalla` vacío | [V11](../../EPT-95/disenos/variantes/V11-cuotas-vacio.png) |
| `EstadoPantalla` error | [V12](../../EPT-95/disenos/variantes/V12-cuotas-error-conexion.png) |

Referencia de comportamiento: `alerta` en `vista.mjs`; estados de `cuotas` en `pantallas.mjs`.

## Variantes

| Pieza | Variante | Fondo / texto / borde | Ícono por defecto |
|---|---|---|---|
| `Aviso` | `informativo` | `primario50` / `primario700` / `primario500` | `info` |
| `Aviso` | `advertencia` | `advertenciaFondo` / `advertenciaTexto` / `advertenciaTexto` | `alerta` |
| `Aviso` | `error` | `peligroFondo` / `peligroTexto` / `peligroTexto` | `alerta` |
| `Aviso` | `exito` | `exitoFondo` / `exitoTexto` / `exitoTexto` | `check` |
| `EstadoPantalla` | `cargando` · `vacio` · `error` | Esqueleto `neutro200` · icono y texto centrados · `Aviso` de error + `Boton` | — |

`exito` existe en `estilos.css` (`.alert.ok`) pero **ninguna lámina de EPT-95 lo usa**: el prototipo comunica la recepción del comprobante con un aviso informativo e ícono de tilde. Se lista para completar el catálogo, sin lámina de respaldo.

## Props y tipos

```ts
import type { ReactElement } from 'react'

export type TipoAviso = 'informativo' | 'advertencia' | 'error' | 'exito'
export type IconoAviso = 'info' | 'reloj' | 'alerta' | 'candado' | 'ojo' | 'check'

export interface AvisoProps {
  tipo: TipoAviso
  /** Primera línea en negrita, por ejemplo «No pudimos iniciar sesión.». */
  titulo?: string
  mensaje: string
  /** Si se omite se usa el ícono por defecto del tipo. El ícono es decorativo. */
  icono?: IconoAviso
  /** `alerta`: interrumpe (errores y bloqueos). `estado`: educado, sin interrumpir. Omitido: no se anuncia. */
  anuncio?: 'alerta' | 'estado'
}

export declare function Aviso(props: AvisoProps): ReactElement

export type EstadoPantallaProps =
  | { tipo: 'cargando'; mensaje: string }
  | { tipo: 'vacio'; titulo: string; descripcion?: string; icono?: IconoAviso }
  | { tipo: 'error'; titulo: string; descripcion: string; onReintentar?: () => void }

export declare function EstadoPantalla(props: EstadoPantallaProps): ReactElement
```

## Eventos y callbacks

| Pieza | Evento | Contrato |
|---|---|---|
| `Aviso` | ninguno | Informativo, no tocable |
| `EstadoPantalla` (`error`) | `onReintentar()` | El contenedor vuelve a leer. Si no se informa, no hay botón (error no reintentable) |

Para un resultado **incierto** de escritura (por ejemplo, el envío de un comprobante cuyo resultado no se pudo confirmar) la vista no ofrece «Reintentar»: ofrece «Revisar estado» y el contenedor relee antes de permitir un único reintento (EPT-98 §6; EPT-96 N06). Es una pantalla compuesta con `Aviso` + `Boton`, no un caso de `EstadoPantalla`.

## Estados

| Estado | `Aviso` | `EstadoPantalla` |
|---|---|---|
| Normal | Cuatro tipos | — |
| Carga | — | `cargando`: tres líneas de esqueleto (55 %, 80 %, 40 % de ancho, alto 18, radio `radio.md`) y mensaje «Cargando cuotas…»; el esqueleto es decorativo |
| Vacío | — | `vacio`: ícono de 40, título (`texto.subtitulo`) y descripción; centrados |
| Error | Tipo `error` | `error`: aviso de error y botón «Reintentar» |
| Deshabilitado / selección | No aplican | No aplican |

Mensajes de ejemplo de EPT-95/96: «Todavía no hay cuotas pagadas», «Cuando Dirección apruebe un pago, la cuota aparecerá acá.», «No pudimos cargar las cuotas. Revisá tu conexión e intentá nuevamente.», «Todavía no tenés estudiantes asociados». Los textos de ejemplo provienen del prototipo de EPT-96 (`cuotas`, `selector` y `comprobantes` en `pantallas.mjs`) y de las láminas; la redacción definitiva la aporta el contenedor o el catálogo de mensajes, y la vista no redacta errores técnicos.

## Tokens y dimensiones

- `Aviso`: relleno 12 × 14, `gap` 10, borde `borde.insignia` (1,5), radio `radio.md`, texto `texto.avisoCuerpo` (15, peso 400) y título `texto.avisoTitulo` (15, peso 700), ícono de 20 alineado a la primera línea.
- `EstadoPantalla`: contenido centrado, ícono de 40, `gap` 12. El botón de reintento usa `Boton` primario.

## Contenido largo

- Título y mensaje se parten en líneas; el aviso crece en alto. No se truncan.
- Nunca se muestran códigos de error del sistema (SQLSTATE, mensajes de PostgREST).

## Accesibilidad

| Aspecto | Contrato |
|---|---|
| Errores y bloqueos | `accessibilityRole="alert"` con `anuncio="alerta"`; en Android `accessibilityLiveRegion="assertive"` si no debe esperar |
| Estados y confirmaciones | `anuncio="estado"`: `accessibilityLiveRegion="polite"`; en iOS se complementa con `AccessibilityInfo.announceForAccessibility` desde el contenedor |
| Carga | `accessibilityState={{ busy: true }}` en el contenedor del esqueleto y `accessibilityLiveRegion="polite"` en el mensaje; el esqueleto no se lee |
| Íconos | Decorativos: no portan información; el texto lo dice todo |
| Información no cromática | Ícono + texto + trazo; el color refuerza |
| Contraste | Mínimo 7,22:1 (ver `tokens.md`) |

Los anuncios deben **no afirmar** pago aprobado: «pendiente de verificación» nunca se presenta como confirmación (EPT-95 `estados-y-roles.md`).

## Responsabilidad y exclusiones

| Hace | No hace |
|---|---|
| Presentar el mensaje y el estado recibido, con anuncio accesible | Decidir si hay error, vacío o carga: lo decide el contenedor con `EstadoRemoto` |
| Ofrecer «Reintentar» cuando el contenedor lo habilita | Reintentar por su cuenta o programar reintentos |
| Mantener el mismo aspecto en todas las pantallas | Traducir códigos de error (EPT-98 §6) |

## Ejemplo de composición

```tsx
import type { ReactElement } from 'react'

export interface CuotasVistaProps {
  estado: EstadoRemoto<{ cuotas: CuotaVista[]; saldoTotal: Centavos }>
  pestana: 'pendientes' | 'pagadas'
  onAbrirCuota: (cuotaId: string) => void
  onReintentar: () => void
}

export function CuotasVista(props: CuotasVistaProps): ReactElement {
  if (props.estado.tipo === 'cargando') {
    return <EstadoPantalla tipo="cargando" mensaje="Cargando cuotas…" />
  }
  if (props.estado.tipo === 'error') {
    return (
      <EstadoPantalla
        tipo="error"
        titulo="No pudimos cargar las cuotas."
        descripcion="Revisá tu conexión e intentá nuevamente."
        onReintentar={props.estado.reintentable ? props.onReintentar : undefined}
      />
    )
  }
  const { cuotas, saldoTotal } = props.estado.datos
  if (cuotas.length === 0) {
    return props.pestana === 'pagadas'
      ? <EstadoPantalla tipo="vacio" titulo="Todavía no hay cuotas pagadas" descripcion="Cuando Dirección apruebe un pago, la cuota aparecerá acá." />
      : <EstadoPantalla tipo="vacio" titulo="No hay cuotas pendientes" descripcion="No tenés saldos por pagar." />
  }
  return (
    <View style={{ gap: 16 }}>
      <Tarjeta>
        <FilaClaveValor etiqueta="Saldo total adeudado" valor={<Importe centavos={saldoTotal} />} />
      </Tarjeta>
      {cuotas.map(cuota => (
        <TarjetaCuota key={cuota.id} cuota={cuota} onPress={props.onAbrirCuota} />
      ))}
    </View>
  )
}
```
