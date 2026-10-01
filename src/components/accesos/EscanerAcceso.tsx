'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  ArrowClockwise,
  Camera,
  CheckCircle,
  ClockCountdown,
  ImageSquare,
  Question,
  Stop,
  WarningOctagon,
  XCircle,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/Button'
import { decodificarArchivo, generarUuid } from '@/lib/accesos-qr/decodificar'
import type { CodigoResultado } from '@/lib/accesos-qr/errores'
import {
  formatearMomentoBA,
  type RespuestaEscaneo,
  type Sentido,
  type ServicioEscaneable,
  type TipoServicio,
} from '@/lib/accesos-qr/tipos'
import { registrarAccesoRemoto, type DatosRegistroRemoto } from '@/services/accesos-qr.client'
import { useCamaraQr, type EstadoCamara } from '@/components/accesos/useCamaraQr'

/**
 * Escáner de accesos con QR para el comedor y el transporte (EPT-65, RF21).
 *
 * Esta pantalla NO es una frontera de seguridad: se monta solo para DIRECTOR y
 * PERSONAL, pero el servidor y PostgreSQL vuelven a decidir todo. Sin registro
 * manual por legajo o DNI y sin modo sin conexión: el único camino es leer un QR
 * (cámara o fotografía), y ambos pasan por la MISMA verificación de firma en el
 * servidor.
 *
 * Privacidad en dispositivos compartidos:
 *  - el payload del QR vive solo en memoria: ni `localStorage`, ni `sessionStorage`,
 *    ni la URL; se descarta al resolver el intento;
 *  - los datos del alumno se ocultan solos a los 5 segundos;
 *  - las imágenes se decodifican en el dispositivo y no se suben.
 *
 * Reintentos: cada lectura genera UN `intento_id`. Si el pedido se corta o
 * expira, «Reintentar» reutiliza el mismo intento y el mismo payload, de modo
 * que la base devuelve lo ya guardado en lugar de duplicar el acceso.
 */

/** Tiempo que permanecen visibles los datos de la persona tras un REGISTRADO. */
export const TIEMPO_DATOS_VISIBLES_MS = 5_000

type Origen = 'camara' | 'foto'

type Fallo = {
  mensaje: string
  estado: number
  reintentable: boolean
  reintentarEnSegundos?: number
}

const MENSAJES_CAMARA: Partial<Record<EstadoCamara, string>> = {
  solicitando: 'Esperando el permiso de la cámara. Aceptalo en el aviso del navegador.',
  tiempo:
    'No recibimos respuesta del aviso de permiso de la cámara. Revisá el aviso del navegador, reintentá o usá una foto del QR.',
  denegada:
    'El navegador no permitió usar la cámara. Habilitala en los permisos del sitio o usá una foto del QR.',
  'sin-camara': 'No encontramos una cámara en este dispositivo. Usá una foto del QR.',
  insegura: 'La cámara solo funciona en una conexión segura (HTTPS). Usá una foto del QR.',
  error:
    'No pudimos iniciar la cámara. Cerrá otras aplicaciones que la estén usando y reintentá, o usá una foto del QR.',
}

type ApariencionResultado = {
  titulo: string
  Icono: typeof CheckCircle
  clases: string
}

const APARIENCIA: Record<CodigoResultado, ApariencionResultado> = {
  REGISTRADO: {
    titulo: 'Acceso registrado',
    Icono: CheckCircle,
    clases: 'border-green-300 bg-green-50 text-green-900',
  },
  YA_REGISTRADO: {
    titulo: 'Ya registrado hoy',
    Icono: ClockCountdown,
    clases: 'border-amber-300 bg-amber-50 text-amber-900',
  },
  NO_HABILITADO: {
    titulo: 'No habilitado',
    Icono: XCircle,
    clases: 'border-red-300 bg-red-50 text-red-900',
  },
  NO_RECONOCIDO: {
    titulo: 'Código QR no reconocido',
    Icono: Question,
    clases: 'border-red-300 bg-red-50 text-red-900',
  },
}

function minutos(segundos: number): string {
  const n = Math.max(1, Math.ceil(segundos / 60))
  return n === 1 ? '1 minuto' : `${n} minutos`
}

export function EscanerAcceso({ servicios }: { servicios: ServicioEscaneable[] }) {
  const idBase = useId()
  const comedor = servicios.find((s) => s.tipo === 'COMEDOR') ?? null
  const recorridos = servicios.filter((s) => s.tipo === 'TRANSPORTE')

  const [tipo, setTipo] = useState<TipoServicio>(comedor ? 'COMEDOR' : 'TRANSPORTE')
  const [recorridoId, setRecorridoId] = useState('')
  const [sentido, setSentido] = useState<Sentido | ''>('')
  const [fase, setFase] = useState<'listo' | 'enviando' | 'terminado'>('listo')
  const [resultado, setResultado] = useState<RespuestaEscaneo | null>(null)
  const [fallo, setFallo] = useState<Fallo | null>(null)
  const [ilegible, setIlegible] = useState(false)
  const [datosVisibles, setDatosVisibles] = useState(true)

  const origenRef = useRef<Origen>('camara')
  // Solo en memoria. Se descarta cuando el intento se resuelve.
  const pendienteRef = useRef<DatosRegistroRemoto | null>(null)
  const tituloResultadoRef = useRef<HTMLHeadingElement>(null)
  const botonFotoRef = useRef<HTMLButtonElement>(null)
  const entradaFotoRef = useRef<HTMLInputElement>(null)

  const servicioId = tipo === 'COMEDOR' ? (comedor?.id ?? '') : recorridoId
  const seleccionCompleta = tipo === 'COMEDOR' ? comedor !== null : recorridoId !== '' && sentido !== ''
  const ocupado = fase === 'enviando'

  const enviar = useCallback(async (datos: DatosRegistroRemoto) => {
    pendienteRef.current = datos
    setFase('enviando')
    setFallo(null)
    setResultado(null)
    setIlegible(false)
    const respuesta = await registrarAccesoRemoto(datos)
    if (respuesta.ok) {
      pendienteRef.current = null
      setResultado(respuesta.respuesta)
      setDatosVisibles(true)
      setFase('terminado')
      return
    }
    // Solo un corte o un tiempo agotado conservan el payload para reintentar el MISMO intento.
    if (!respuesta.reintentable) pendienteRef.current = null
    setFallo({
      mensaje: respuesta.mensaje,
      estado: respuesta.estado,
      reintentable: respuesta.reintentable,
      reintentarEnSegundos: respuesta.reintentarEnSegundos,
    })
    setFase('terminado')
  }, [])

  const alLeerTexto = useCallback(
    (texto: string) => {
      if (!servicioId) return
      void enviar({
        payload: texto,
        intentoId: generarUuid(),
        servicioId,
        ...(tipo === 'TRANSPORTE' && sentido ? { sentido } : {}),
      })
    },
    [enviar, servicioId, sentido, tipo]
  )

  const { videoRef, estado: estadoCamara, iniciar, detener } = useCamaraQr({ alLeer: alLeerTexto })

  /** Cambiar cualquier parte de la selección detiene la cámara y limpia el resultado. */
  function reiniciarSeleccion() {
    detener()
    pendienteRef.current = null
    setResultado(null)
    setFallo(null)
    setIlegible(false)
    setFase('listo')
  }

  function iniciarCamara() {
    origenRef.current = 'camara'
    setIlegible(false)
    void iniciar()
  }

  async function alElegirArchivo(evento: React.ChangeEvent<HTMLInputElement>) {
    const archivo = evento.target.files?.[0]
    // Se limpia el control: el navegador no conserva la referencia a la fotografía.
    evento.target.value = ''
    if (!archivo) return
    origenRef.current = 'foto'
    detener()
    setIlegible(false)
    let texto: string | null = null
    try {
      texto = await decodificarArchivo(archivo)
    } catch {
      texto = null
    }
    if (!texto) {
      setIlegible(true)
      return
    }
    alLeerTexto(texto)
  }

  function reintentarMismoIntento() {
    const pendiente = pendienteRef.current
    if (pendiente) void enviar(pendiente)
  }

  function escanearSiguiente() {
    pendienteRef.current = null
    setResultado(null)
    setFallo(null)
    setIlegible(false)
    setFase('listo')
    if (origenRef.current === 'camara' && seleccionCompleta) {
      // El clic es el gesto que exige el navegador para volver a pedir la cámara.
      void iniciar()
    } else {
      setTimeout(() => botonFotoRef.current?.focus(), 0)
    }
  }

  // Foco al resultado cuando aparece (lectores de pantalla y teclado).
  useEffect(() => {
    if (fase === 'terminado') tituloResultadoRef.current?.focus()
  }, [fase, resultado, fallo])

  // Los datos de la persona se ocultan solos a los 5 segundos.
  useEffect(() => {
    if (fase !== 'terminado' || resultado?.codigo !== 'REGISTRADO') return
    const reloj = setTimeout(() => setDatosVisibles(false), TIEMPO_DATOS_VISIBLES_MS)
    return () => clearTimeout(reloj)
  }, [fase, resultado])

  // Al desmontar no queda ningún payload en memoria.
  useEffect(() => {
    const pendiente = pendienteRef
    return () => {
      pendiente.current = null
    }
  }, [])

  const esExito = fase === 'terminado' && resultado?.codigo === 'REGISTRADO'
  const esRechazo = fase === 'terminado' && !esExito
  const camaraActiva = estadoCamara === 'activa'
  const mensajeCamara = MENSAJES_CAMARA[estadoCamara]
  const idAyuda = `${idBase}-ayuda`

  const apariencia = resultado ? APARIENCIA[resultado.codigo] : null

  const tarjeta = (
    <div
      data-testid="escaner-resultado"
      data-codigo={resultado?.codigo ?? fallo?.estado ?? ''}
      className={`rounded-2xl border p-5 ${
        apariencia ? apariencia.clases : 'border-red-300 bg-red-50 text-red-900'
      }`}
    >
      <div className="flex items-start gap-3">
        {apariencia ? (
          <apariencia.Icono size={32} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
        ) : fallo?.estado === 429 ? (
          <ClockCountdown size={32} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
        ) : (
          <WarningOctagon size={32} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
        )}
        <div className="min-w-0">
          <h2
            ref={tituloResultadoRef}
            tabIndex={-1}
            className="text-lg font-extrabold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
          >
            {apariencia
              ? apariencia.titulo
              : fallo?.estado === 429
                ? 'Demasiados intentos'
                : 'No se pudo registrar'}
          </h2>
          {resultado ? (
            <>
              {resultado.codigo === 'REGISTRADO' && resultado.alumno ? (
                datosVisibles ? (
                  <dl className="mt-2 space-y-1 text-sm" data-testid="escaner-datos">
                    <div className="flex gap-2">
                      <dt className="font-semibold">Alumno:</dt>
                      <dd>
                        {resultado.alumno.nombre} {resultado.alumno.apellido}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="font-semibold">Legajo:</dt>
                      <dd>{resultado.alumno.legajo ?? 'sin legajo'}</dd>
                    </div>
                    {resultado.registrado_en && (
                      <div className="flex gap-2">
                        <dt className="font-semibold">Hora:</dt>
                        <dd>{formatearMomentoBA(resultado.registrado_en).hora}</dd>
                      </div>
                    )}
                  </dl>
                ) : (
                  <p className="mt-2 text-sm" data-testid="escaner-datos-ocultos">
                    Los datos del alumno se ocultaron por privacidad.
                  </p>
                )
              ) : (
                <p className="mt-2 text-sm">{resultado.mensaje}</p>
              )}
            </>
          ) : (
            fallo && (
              <p className="mt-2 text-sm">
                {fallo.mensaje}
                {fallo.estado === 429 && fallo.reintentarEnSegundos
                  ? ` Volvé a intentar en unos ${minutos(fallo.reintentarEnSegundos)}.`
                  : ''}
              </p>
            )
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        {fallo?.reintentable && (
          <Button type="button" variant="primary" className="min-h-11" onClick={reintentarMismoIntento}>
            <ArrowClockwise size={18} weight="bold" aria-hidden="true" />
            Reintentar
          </Button>
        )}
        <Button
          type="button"
          variant={esExito ? 'primary' : 'secondary'}
          className="min-h-11"
          onClick={escanearSiguiente}
        >
          Escanear siguiente
        </Button>
      </div>
    </div>
  )

  return (
    <div className="space-y-5">
      {/* 1. Qué se controla */}
      <section aria-labelledby={`${idBase}-servicio`} className="rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 id={`${idBase}-servicio`} className="text-base font-bold text-neutral-900">
          1. ¿Qué servicio estás controlando?
        </h2>
        <fieldset className="mt-3" disabled={ocupado}>
          <legend className="sr-only">Servicio</legend>
          <div className="flex flex-col gap-2 sm:flex-row">
            {(
              [
                ['COMEDOR', 'Comedor'],
                ['TRANSPORTE', 'Transporte'],
              ] as const
            ).map(([valor, etiqueta]) => (
              <label
                key={valor}
                className="flex min-h-11 flex-1 cursor-pointer items-center gap-3 rounded-lg border border-neutral-300 px-4 text-sm font-semibold text-neutral-800 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
              >
                <input
                  type="radio"
                  name={`${idBase}-tipo`}
                  value={valor}
                  checked={tipo === valor}
                  disabled={valor === 'COMEDOR' ? comedor === null : recorridos.length === 0}
                  onChange={() => {
                    reiniciarSeleccion()
                    setTipo(valor)
                  }}
                  className="size-5 accent-brand-600"
                />
                {etiqueta}
              </label>
            ))}
          </div>
        </fieldset>

        {tipo === 'TRANSPORTE' && (
          <div className="mt-4 space-y-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${idBase}-recorrido`} className="text-sm font-semibold text-neutral-700">
                Recorrido donde estás escaneando
              </label>
              <select
                id={`${idBase}-recorrido`}
                value={recorridoId}
                disabled={ocupado}
                onChange={(e) => {
                  reiniciarSeleccion()
                  setRecorridoId(e.target.value)
                }}
                className="min-h-11 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
              >
                <option value="">Elegí un recorrido</option>
                {recorridos.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nombre}
                  </option>
                ))}
              </select>
            </div>
            <fieldset disabled={ocupado}>
              <legend className="text-sm font-semibold text-neutral-700">Sentido</legend>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                {(
                  [
                    ['IDA', 'Ida'],
                    ['VUELTA', 'Vuelta'],
                  ] as const
                ).map(([valor, etiqueta]) => (
                  <label
                    key={valor}
                    className="flex min-h-11 flex-1 cursor-pointer items-center gap-3 rounded-lg border border-neutral-300 px-4 text-sm font-semibold text-neutral-800 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50"
                  >
                    <input
                      type="radio"
                      name={`${idBase}-sentido`}
                      value={valor}
                      checked={sentido === valor}
                      onChange={() => {
                        reiniciarSeleccion()
                        setSentido(valor)
                      }}
                      className="size-5 accent-brand-600"
                    />
                    {etiqueta}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        )}
      </section>

      {/* 2. Captura */}
      <section aria-labelledby={`${idBase}-captura`} className="rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 id={`${idBase}-captura`} className="text-base font-bold text-neutral-900">
          2. Leé el código QR
        </h2>
        <p id={idAyuda} className="mt-1 text-sm text-neutral-600">
          {seleccionCompleta
            ? 'Usá la cámara o sacale una foto al código. La imagen se procesa en este dispositivo y no se guarda.'
            : tipo === 'TRANSPORTE'
              ? 'Elegí el recorrido y el sentido para habilitar la lectura.'
              : 'No hay un servicio de comedor activo para registrar accesos.'}
        </p>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          {camaraActiva || estadoCamara === 'solicitando' ? (
            <Button type="button" variant="secondary" className="min-h-11" onClick={detener}>
              <Stop size={18} weight="bold" aria-hidden="true" />
              Detener la cámara
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              className="min-h-11"
              onClick={iniciarCamara}
              disabled={!seleccionCompleta || ocupado}
              aria-describedby={idAyuda}
            >
              <Camera size={18} weight="bold" aria-hidden="true" />
              Escanear con la cámara
            </Button>
          )}
          <Button
            type="button"
            ref={botonFotoRef}
            variant="outline"
            className="min-h-11"
            onClick={() => entradaFotoRef.current?.click()}
            disabled={!seleccionCompleta || ocupado}
            aria-describedby={idAyuda}
          >
            <ImageSquare size={18} weight="bold" aria-hidden="true" />
            Usar una foto del QR
          </Button>
          <input
            ref={entradaFotoRef}
            type="file"
            accept="image/*"
            tabIndex={-1}
            aria-hidden="true"
            className="sr-only"
            data-testid="escaner-foto"
            onChange={alElegirArchivo}
          />
        </div>

        {/* El video está siempre montado para que la cámara tenga dónde mostrarse. */}
        <div className={camaraActiva ? 'mt-4' : 'sr-only'} data-testid="escaner-vista-camara">
          <video
            ref={videoRef}
            playsInline
            muted
            aria-label="Vista previa de la cámara"
            className="aspect-[4/3] w-full max-w-md rounded-xl bg-neutral-900 object-cover"
          />
        </div>

        <div aria-live="polite" className="mt-3 min-h-5 text-sm text-neutral-700" data-testid="escaner-estado-camara">
          {mensajeCamara && estadoCamara !== 'solicitando' && (
            <p role={estadoCamara === 'error' || estadoCamara === 'denegada' ? 'alert' : undefined}>
              {mensajeCamara}
            </p>
          )}
          {estadoCamara === 'solicitando' && <p>{mensajeCamara}</p>}
          {camaraActiva && <p>Cámara activa. Apuntá al código QR.</p>}
          {ilegible && (
            <p role="alert" className="text-red-800" data-testid="escaner-ilegible">
              No pudimos leer un código QR en la imagen. Acercá el código, evitá los reflejos y probá de nuevo.
            </p>
          )}
        </div>
        {estadoCamara === 'tiempo' && (
          <div className="mt-2">
            <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={iniciarCamara}>
              Reintentar cámara
            </Button>
          </div>
        )}
      </section>

      {/* 3. Resultado */}
      <section aria-label="Resultado del escaneo" aria-busy={ocupado}>
        {ocupado && (
          <p role="status" className="rounded-2xl border border-neutral-200 bg-white p-5 text-sm text-neutral-700">
            Registrando el acceso…
          </p>
        )}
        {/* Éxito: región cortés. Rechazo o error: región asertiva. Ambas existen siempre. */}
        <div role="status" aria-live="polite" aria-atomic="true">
          {esExito && tarjeta}
        </div>
        <div role="alert" aria-live="assertive" aria-atomic="true">
          {esRechazo && tarjeta}
        </div>
      </section>
    </div>
  )
}
