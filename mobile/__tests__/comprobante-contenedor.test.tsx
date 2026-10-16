import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import {
  COMPROBANTE_VACIO,
  ComprobanteContenedor,
  type EstadoComprobante,
} from '@/contenedores/comprobantes/ComprobanteContenedor'
import type { AlmacenamientoSeguro } from '@/servicios/almacenamiento-seguro'
import { leerCargaPendiente } from '@/servicios/carga-pendiente'
import type { ResultadoSubida, SolicitudSubida } from '@/servicios/comprobantes'
import type { ArchivoElegido, ResultadoSeleccion, SelectorArchivos } from '@/servicios/selector-archivos'
import type { ClienteEPT } from '@/servicios/supabase'
import { ErrorTransporte, type TransporteHttp } from '@/servicios/transporte-http'

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
  SafeAreaView: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}))

const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PERFIL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const A1 = '11111111-1111-4111-8111-111111111111'
const PAGO = '44444444-4444-4444-8444-444444444444'
const PAGO_B = '44444444-4444-4444-8444-444444444445'
const CARGA = '66666666-6666-4666-8666-666666666666'
const CLAVE = '55555555-5555-4555-8555-555555555555'

type Respuesta = { data: unknown; error: unknown; status: number }
interface RpcPendiente {
  nombre: string
  args: Record<string, unknown>
  resolver: (r: Respuesta) => void
}

const FILA_PAGO = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  alumno_id: A1,
  creado_en: '2026-10-14T12:00:00+00:00',
  fecha_transferencia: null,
  numero_operacion: null,
  total: '50000.00',
  importe: null,
  ...extra,
})

const cargaJson = (estado = 'PREPARADA', extra: Record<string, unknown> = {}) => ({
  carga_id: CARGA,
  clave_carga: CLAVE,
  pago_id: PAGO,
  estado,
  motivo_descarte: null,
  bucket_temporal: 'comprobantes-pago-temporal',
  ruta_temporal: `${PAGO}/${CARGA}`,
  tipo_mime: 'image/jpeg',
  tamano_bytes: 2048,
  fecha_transferencia: '2026-10-14',
  importe_centavos: 1500050,
  numero_operacion: 'OP-123',
  comprobante_id: estado === 'CONFIRMADA' ? CARGA : null,
  cantidad_archivos: estado === 'CONFIRMADA' ? 1 : 0,
  estado_pago: 'PENDIENTE_VERIFICACION',
  creado_en: '2026-10-14T12:01:00+00:00',
  resuelto_en: null,
  repetido: false,
  ...extra,
})

const FOTO: ArchivoElegido = {
  uri: 'file:///cache/foto.jpg',
  nombre: 'foto.jpg',
  tipo: 'image/jpeg',
  tamanoBytes: 2048,
}

function crearMundo(opciones: { pagos?: Record<string, unknown>[]; archivos?: number } = {}) {
  const rpcs: RpcPendiente[] = []
  const filasPagos = opciones.pagos ?? [FILA_PAGO(PAGO)]
  const cliente = {
    from(tabla: string) {
      const datos =
        tabla === 'perfiles'
          ? { id: PERFIL }
          : tabla === 'pagos'
            ? filasPagos
            : Array.from({ length: opciones.archivos ?? 0 }, () => ({ pago_id: PAGO }))
      const c = {
        select: () => c,
        eq: () => c,
        in: () => c,
        order: () => c,
        limit: () => c,
        abortSignal: () => c,
        maybeSingle: () => Promise.resolve({ data: datos, error: null }),
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
          Promise.resolve({ data: datos, error: null }).then(ok, ko),
      }
      return c
    },
    rpc(nombre: string, args: Record<string, unknown> = {}) {
      const c = {
        abortSignal: () => c,
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
          new Promise<Respuesta>(resolver => {
            rpcs.push({ nombre, args, resolver })
          }).then(ok, ko),
      }
      return c
    },
  } as unknown as ClienteEPT

  const subidas: { solicitud: SolicitudSubida; resolver: (r: ResultadoSubida) => void }[] = []
  const subir = jest.fn(
    (solicitud: SolicitudSubida) =>
      new Promise<ResultadoSubida>(resolver => {
        subidas.push({ solicitud, resolver })
      }),
  )

  const llamadasHttp: { ruta: string; resolver: (r: unknown) => void; fallar: (e: unknown) => void }[] = []
  const transporte: TransporteHttp = {
    solicitar: jest.fn(
      (ruta: string) =>
        new Promise((resolver, fallar) => {
          llamadasHttp.push({ ruta, resolver, fallar })
        }),
    ) as unknown as TransporteHttp['solicitar'],
  }

  const seleccion: { siguiente: ResultadoSeleccion } = { siguiente: { tipo: 'elegido', archivo: FOTO } }
  const selector: SelectorArchivos = {
    tomarFoto: jest.fn(async () => seleccion.siguiente),
    elegirImagen: jest.fn(async () => seleccion.siguiente),
    elegirArchivo: jest.fn(async () => seleccion.siguiente),
  }

  const datos = new Map<string, string>()
  const almacenamiento: AlmacenamientoSeguro = {
    getItem: async k => datos.get(k) ?? null,
    setItem: async (k, v) => {
      datos.set(k, v)
    },
    removeItem: async k => {
      datos.delete(k)
    },
  }
  return { cliente, rpcs, subir, subidas, transporte, llamadasHttp, selector, seleccion, almacenamiento }
}

type Mundo = ReturnType<typeof crearMundo>

async function responder(mundo: Mundo, nombre: string, data: unknown, error: unknown = null, status = 200) {
  const i = mundo.rpcs.findIndex(r => r.nombre === nombre)
  if (i < 0) throw new Error(`No hay ${nombre} pendiente`)
  const [r] = mundo.rpcs.splice(i, 1)
  await act(async () => {
    r?.resolver({ data: error ? null : data, error, status })
  })
  return r as RpcPendiente
}

async function abrirFormulario(mundo: Mundo, extra: Partial<React.ComponentProps<typeof ComprobanteContenedor>> = {}) {
  await render(
    <ComprobanteContenedor
      cliente={mundo.cliente}
      usuarioId={U}
      alumnoId={A1}
      etiquetaAlumno="Ana Pérez"
      almacenamiento={mundo.almacenamiento}
      transporte={mundo.transporte}
      selector={mundo.selector}
      subir={mundo.subir}
      onVolver={jest.fn()}
      generarClave={() => CLAVE}
      {...extra}
    />,
  )
  await waitFor(() => expect(screen.getByTestId(`adjuntar-${PAGO}`)).toBeTruthy())
  await fireEvent.press(screen.getByTestId(`adjuntar-${PAGO}`))
  await waitFor(() => expect(screen.getByText('Adjuntar comprobante')).toBeTruthy())
}

async function completar(fecha = '14/10/2026', importe = '15000,50', numero = 'OP-123') {
  await fireEvent.changeText(screen.getByTestId('campo-fecha'), fecha)
  await fireEvent.changeText(screen.getByTestId('campo-importe'), importe)
  await fireEvent.changeText(screen.getByTestId('campo-numero'), numero)
}

async function elegirArchivo() {
  await fireEvent.press(screen.getByTestId('elegir-imagen'))
  await waitFor(() => expect(screen.getByTestId('archivo-elegido')).toBeTruthy())
}

describe('ComprobanteContenedor', () => {
  it('lista los pagos pendientes del padre y no ofrece nada si no hay ninguno', async () => {
    const vacio = crearMundo({ pagos: [] })
    await render(
      <ComprobanteContenedor
        cliente={vacio.cliente}
        usuarioId={U}
        alumnoId={A1}
        etiquetaAlumno="Ana Pérez"
        almacenamiento={vacio.almacenamiento}
        transporte={vacio.transporte}
        selector={vacio.selector}
        subir={vacio.subir}
        onVolver={jest.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByText('No hay pagos pendientes de verificación')).toBeTruthy())
    expect(screen.queryByText('Adjuntar comprobante')).toBeNull()
  })

  it('un pago sin datos pide fecha, importe y número; uno con datos los muestra sin permitir editarlos', async () => {
    const sin = crearMundo()
    await abrirFormulario(sin)
    expect(screen.getByTestId('campo-fecha')).toBeTruthy()
    expect(screen.getByTestId('campo-importe')).toBeTruthy()
    expect(screen.getByTestId('campo-numero')).toBeTruthy()
    expect(screen.getByText(/no aprueba el pago ni cambia tu saldo/u)).toBeTruthy()
  })

  it('con los datos ya informados no vuelve a pedirlos', async () => {
    const con = crearMundo({
      pagos: [FILA_PAGO(PAGO, { fecha_transferencia: '2026-10-14', numero_operacion: 'OP-9', importe: '49000.50' })],
      archivos: 2,
    })
    await abrirFormulario(con)
    expect(screen.queryByTestId('campo-fecha')).toBeNull()
    expect(screen.getByText('Número de operación: OP-9')).toBeTruthy()
    expect(screen.getByText('Fecha: 14/10/2026')).toBeTruthy()
    expect(screen.getByText(/un archivo nuevo no los modifica/u)).toBeTruthy()
  })

  it('valida los campos con el contrato compartido antes de enviar nada', async () => {
    const m = crearMundo()
    await abrirFormulario(m)
    await elegirArchivo()
    await completar('31/02/2026', '1,234', '   ')
    await fireEvent.press(screen.getByTestId('enviar-comprobante'))
    expect(screen.getByText('La fecha no es válida. Usá el formato DD/MM/AAAA.')).toBeTruthy()
    expect(screen.getByText('Escribí el importe con hasta dos decimales, por ejemplo 15000,50.')).toBeTruthy()
    expect(screen.getByText('Ingresá el número de operación.')).toBeTruthy()
    expect(m.rpcs.some(r => r.nombre === 'preparar_carga_comprobante')).toBe(false)
  })

  it('envía en orden preparar → subir → finalizar y muestra Pendiente de verificación', async () => {
    const m = crearMundo()
    await abrirFormulario(m)
    await elegirArchivo()
    await completar()
    await fireEvent.press(screen.getByTestId('enviar-comprobante'))
    await fireEvent.press(screen.getByTestId('enviar-comprobante')) // doble toque
    await waitFor(() => expect(m.rpcs.some(r => r.nombre === 'preparar_carga_comprobante')).toBe(true))
    expect(m.rpcs.filter(r => r.nombre === 'preparar_carga_comprobante')).toHaveLength(1)
    expect(await leerCargaPendiente(m.almacenamiento, U, PAGO)).toMatchObject({ claveCarga: CLAVE })

    const prep = await responder(m, 'preparar_carga_comprobante', cargaJson())
    // Importe y fecha viajan como texto exacto; el cliente no aporta usuario, rol ni hash.
    expect(prep.args).toEqual({
      p_clave_carga: CLAVE,
      p_pago_id: PAGO,
      p_fecha: '2026-10-14',
      p_importe: '15000.50',
      p_numero: 'OP-123',
      p_tipo_mime: 'image/jpeg',
      p_tamano: 2048,
    })

    await waitFor(() => expect(m.subir).toHaveBeenCalledTimes(1))
    const { solicitud, resolver } = m.subidas[0]
    expect(solicitud.bucket).toBe('comprobantes-pago-temporal')
    expect(solicitud.ruta).toBe(`${PAGO}/${CARGA}`)
    expect(solicitud.archivo).toEqual({ uri: FOTO.uri, tipoMime: 'image/jpeg', tamanoBytes: 2048 })
    await act(async () => {
      solicitud.onProgreso(0.5)
    })
    expect(screen.getByText(/Subiendo el archivo… 50 %/u)).toBeTruthy()
    await act(async () => {
      resolver({ tipo: 'subido' })
    })

    await waitFor(() => expect(m.llamadasHttp).toHaveLength(1))
    expect(m.llamadasHttp[0].ruta).toBe(`/api/comprobantes/cargas/${CARGA}/finalizacion`)
    await act(async () => {
      m.llamadasHttp[0].resolver({ estado: 200, datos: { carga: cargaJson('CONFIRMADA') } })
    })

    await waitFor(() => expect(screen.getByText('Comprobante recibido: pendiente de verificación.')).toBeTruthy())
    expect(screen.getByText('Comprobantes del pago: 1')).toBeTruthy()
    expect(await leerCargaPendiente(m.almacenamiento, U, PAGO)).toBeNull()
  })

  it('un pago con datos ya informados envía la carga sin reenviarlos', async () => {
    const m = crearMundo({
      pagos: [FILA_PAGO(PAGO, { fecha_transferencia: '2026-10-14', numero_operacion: 'OP-9', importe: '49000.50' })],
    })
    await abrirFormulario(m)
    await elegirArchivo()
    await fireEvent.press(screen.getByTestId('enviar-comprobante'))
    await waitFor(() => expect(m.rpcs.some(r => r.nombre === 'preparar_carga_comprobante')).toBe(true))
    expect(m.rpcs[0].args).toMatchObject({ p_fecha: null, p_importe: null, p_numero: null, p_pago_id: PAGO })
  })

  it('una respuesta perdida al finalizar no vuelve a enviar: se verifica el resultado', async () => {
    const m = crearMundo()
    await abrirFormulario(m)
    await elegirArchivo()
    await completar()
    await fireEvent.press(screen.getByTestId('enviar-comprobante'))
    await waitFor(() => expect(m.rpcs.length).toBe(1))
    await responder(m, 'preparar_carga_comprobante', cargaJson())
    await waitFor(() => expect(m.subidas).toHaveLength(1))
    await act(async () => {
      m.subidas[0].resolver({ tipo: 'subido' })
    })
    await waitFor(() => expect(m.llamadasHttp).toHaveLength(1))
    await act(async () => {
      m.llamadasHttp[0].fallar(new ErrorTransporte('TIEMPO_AGOTADO'))
    })

    await waitFor(() => expect(screen.getByText('No pudimos confirmar el envío')).toBeTruthy())
    // No hay botón de reenvío hasta consultar la carga.
    expect(screen.queryByTestId('enviar-comprobante')).toBeNull()
    expect(m.subir).toHaveBeenCalledTimes(1)

    await fireEvent.press(screen.getByTestId('verificar-carga'))
    await waitFor(() => expect(m.rpcs.some(r => r.nombre === 'consultar_carga_comprobante')).toBe(true))
    const consulta = await responder(m, 'consultar_carga_comprobante', { registrada: true, ...cargaJson('CONFIRMADA') })
    expect(consulta.args).toEqual({ p_clave_carga: CLAVE })
    await waitFor(() => expect(screen.getByText('Comprobante recibido: pendiente de verificación.')).toBeTruthy())
    expect(m.subir).toHaveBeenCalledTimes(1)
  })

  it('si la carga sigue preparada tras un corte, retoma la subida (que no reemplaza el objeto) y finaliza', async () => {
    const m = crearMundo()
    await abrirFormulario(m)
    await elegirArchivo()
    await completar()
    await fireEvent.press(screen.getByTestId('enviar-comprobante'))
    await waitFor(() => expect(m.rpcs.length).toBe(1))
    await responder(m, 'preparar_carga_comprobante', cargaJson())
    await waitFor(() => expect(m.subidas).toHaveLength(1))
    await act(async () => {
      m.subidas[0].resolver({ tipo: 'subido' })
    })
    await waitFor(() => expect(m.llamadasHttp).toHaveLength(1))
    await act(async () => {
      m.llamadasHttp[0].fallar(
        new ErrorTransporte('HTTP', { estado: 503, cuerpo: { codigo: 'RESULTADO_INCIERTO', mensaje: 'x' } }),
      )
    })
    await waitFor(() => expect(screen.getByTestId('verificar-carga')).toBeTruthy())
    await fireEvent.press(screen.getByTestId('verificar-carga'))
    await waitFor(() => expect(m.rpcs.some(r => r.nombre === 'consultar_carga_comprobante')).toBe(true))
    await responder(m, 'consultar_carga_comprobante', { registrada: true, ...cargaJson('PREPARADA') })
    // Retoma desde la subida del mismo intento (el objeto ya existía: ya_existia) y finaliza.
    await waitFor(() => expect(m.subidas).toHaveLength(2))
    await act(async () => {
      m.subidas[1].resolver({ tipo: 'ya_existia' })
    })
    await waitFor(() => expect(m.llamadasHttp).toHaveLength(2))
    await act(async () => {
      m.llamadasHttp[1].resolver({ estado: 200, datos: { carga: cargaJson('CONFIRMADA') } })
    })
    await waitFor(() => expect(screen.getByText('Comprobante recibido: pendiente de verificación.')).toBeTruthy())
  })

  it('un rechazo cierto del servidor se informa sin reintentar y permite volver a intentar', async () => {
    const m = crearMundo()
    await abrirFormulario(m)
    await elegirArchivo()
    await completar()
    await fireEvent.press(screen.getByTestId('enviar-comprobante'))
    await waitFor(() => expect(m.rpcs.length).toBe(1))
    await responder(m, 'preparar_carga_comprobante', cargaJson())
    await waitFor(() => expect(m.subidas).toHaveLength(1))
    await act(async () => {
      m.subidas[0].resolver({ tipo: 'subido' })
    })
    await waitFor(() => expect(m.llamadasHttp).toHaveLength(1))
    await act(async () => {
      m.llamadasHttp[0].fallar(
        new ErrorTransporte('HTTP', {
          estado: 422,
          cuerpo: { codigo: 'ARCHIVO_CORRUPTO', mensaje: 'El archivo está dañado o incompleto. Elegí otro archivo.' },
        }),
      )
    })
    await waitFor(() => expect(screen.getByText('No registramos nada.')).toBeTruthy())
    expect(screen.getByText('El archivo está dañado o incompleto. Elegí otro archivo.')).toBeTruthy()
    expect(await leerCargaPendiente(m.almacenamiento, U, PAGO)).toBeNull()
    await fireEvent.press(screen.getByTestId('reintentar-comprobante'))
    expect(screen.getByTestId('enviar-comprobante')).toBeTruthy()
  })

  it('un número de operación duplicado se informa desde la preparación y no sube nada', async () => {
    const m = crearMundo()
    await abrirFormulario(m)
    await elegirArchivo()
    await completar()
    await fireEvent.press(screen.getByTestId('enviar-comprobante'))
    await waitFor(() => expect(m.rpcs.length).toBe(1))
    await responder(m, 'preparar_carga_comprobante', null, { code: 'P6863', message: 'x' }, 400)
    await waitFor(() => expect(screen.getByText('Ese número de operación ya está registrado en otro pago.')).toBeTruthy())
    expect(m.subir).not.toHaveBeenCalled()
  })

  it('cada falla de la selección tiene su mensaje y no cambia el archivo elegido', async () => {
    const m = crearMundo()
    await abrirFormulario(m)
    const casos: [ResultadoSeleccion, string, string][] = [
      [{ tipo: 'permiso_denegado', puedePreguntar: true }, 'tomar-foto', 'Necesitamos permiso para usar la cámara'],
      [{ tipo: 'permiso_denegado', puedePreguntar: false }, 'tomar-foto', 'El permiso de la cámara está denegado'],
      [{ tipo: 'sin_camara' }, 'tomar-foto', 'Este dispositivo no tiene una cámara disponible'],
      [{ tipo: 'invalido', mensaje: 'El archivo supera el máximo de 5 MB.' }, 'elegir-archivo', 'El archivo supera el máximo de 5 MB.'],
      [{ tipo: 'error' }, 'elegir-imagen', 'No pudimos leer el archivo'],
    ]
    for (const [resultado, boton, texto] of casos) {
      m.seleccion.siguiente = resultado
      await fireEvent.press(screen.getByTestId(boton))
      await waitFor(() => expect(screen.getByText(new RegExp(texto, 'u'))).toBeTruthy())
      expect(screen.queryByTestId('archivo-elegido')).toBeNull()
    }
    // Cancelar no es un error ni cambia nada.
    m.seleccion.siguiente = { tipo: 'cancelado' }
    await fireEvent.press(screen.getByTestId('elegir-imagen'))
    expect(screen.queryByTestId('archivo-elegido')).toBeNull()
  })

  it('un PDF muestra su nombre y tamaño en lugar de una vista previa de imagen', async () => {
    const m = crearMundo()
    m.seleccion.siguiente = {
      tipo: 'elegido',
      archivo: { uri: 'file:///cache/x.pdf', nombre: 'transferencia.pdf', tipo: 'application/pdf', tamanoBytes: 1048576 },
    }
    await abrirFormulario(m)
    await fireEvent.press(screen.getByTestId('elegir-archivo'))
    await waitFor(() => expect(screen.getByTestId('vista-previa-pdf')).toBeTruthy())
    expect(screen.getByText('transferencia.pdf · 1,0 MB')).toBeTruthy()
    expect(screen.queryByTestId('vista-previa')).toBeNull()
    await fireEvent.press(screen.getByTestId('quitar-archivo'))
    expect(screen.queryByTestId('archivo-elegido')).toBeNull()
  })

  it('el estado sobrevive a un remontaje: un envío en vuelo termina y se muestra en la instancia nueva', async () => {
    const m = crearMundo()
    function Anfitrion({ visible }: { visible: boolean }) {
      const [estado, setEstado] = useState<EstadoComprobante>({ ...COMPROBANTE_VACIO, pagoId: PAGO })
      return visible ? (
        <ComprobanteContenedor
          cliente={m.cliente}
          usuarioId={U}
          alumnoId={A1}
          etiquetaAlumno="Ana Pérez"
          almacenamiento={m.almacenamiento}
          transporte={m.transporte}
          selector={m.selector}
          subir={m.subir}
          estado={estado}
          onEstado={setEstado}
          onVolver={jest.fn()}
          generarClave={() => CLAVE}
        />
      ) : null
    }
    const { rerender } = await render(<Anfitrion visible />)
    await waitFor(() => expect(screen.getByTestId('elegir-imagen')).toBeTruthy())
    await elegirArchivo()
    await completar()
    await fireEvent.press(screen.getByTestId('enviar-comprobante'))
    await waitFor(() => expect(m.rpcs.length).toBe(1))
    await responder(m, 'preparar_carga_comprobante', cargaJson())
    await waitFor(() => expect(m.subidas).toHaveLength(1))

    // La revalidación de la sesión remonta la pantalla mientras la subida sigue en vuelo.
    await rerender(<Anfitrion visible={false} />)
    await rerender(<Anfitrion visible />)
    await waitFor(() => expect(screen.getByTestId('enviar-comprobante')).toBeTruthy())
    expect(screen.getByTestId('archivo-elegido')).toBeTruthy()

    await act(async () => {
      m.subidas[0].resolver({ tipo: 'subido' })
    })
    await waitFor(() => expect(m.llamadasHttp).toHaveLength(1))
    await act(async () => {
      m.llamadasHttp[0].resolver({ estado: 200, datos: { carga: cargaJson('CONFIRMADA') } })
    })
    await waitFor(() => expect(screen.getByText('Comprobante recibido: pendiente de verificación.')).toBeTruthy())
  })

  it('elegir otro pago no hereda archivo, datos ni clave del anterior', async () => {
    const m = crearMundo({ pagos: [FILA_PAGO(PAGO), FILA_PAGO(PAGO_B)] })
    await render(
      <ComprobanteContenedor
        cliente={m.cliente}
        usuarioId={U}
        alumnoId={A1}
        etiquetaAlumno="Ana Pérez"
        almacenamiento={m.almacenamiento}
        transporte={m.transporte}
        selector={m.selector}
        subir={m.subir}
        onVolver={jest.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByTestId(`adjuntar-${PAGO}`)).toBeTruthy())
    await fireEvent.press(screen.getByTestId(`adjuntar-${PAGO}`))
    await elegirArchivo()
    await completar()
    await fireEvent.press(screen.getByTestId('volver-lista-comprobantes'))
    await waitFor(() => expect(screen.getByTestId(`adjuntar-${PAGO_B}`)).toBeTruthy())
    await fireEvent.press(screen.getByTestId(`adjuntar-${PAGO_B}`))
    await waitFor(() => expect(screen.getByTestId('campo-fecha')).toBeTruthy())
    expect(screen.queryByTestId('archivo-elegido')).toBeNull()
    expect(screen.getByTestId('campo-numero').props.value).toBe('')
  })
})
