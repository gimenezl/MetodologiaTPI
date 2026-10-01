'use client'

import Link from 'next/link'
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Prohibit } from '@phosphor-icons/react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialogo } from '@/components/ui/Dialogo'
import { estilosDeBoton } from '@/components/ui/estilosDeBoton'
import type { FilaAcceso, ServicioEscaneable } from '@/lib/accesos-qr/tipos'
import { anularAccesoRemoto } from '@/services/accesos-qr.client'

/**
 * Auditoría de accesos para Dirección (EPT-65, RF21): lista paginada y filtrable
 * de eventos y denegaciones, con el motivo interno de cada denegación y la
 * anulación de un acceso registrado por error.
 *
 * Esta pantalla NO es una frontera de seguridad: la ruta solo se monta para
 * Dirección, y tanto la lectura como la anulación vuelven a exigir el rol en el
 * servidor y en PostgreSQL. Los filtros son un formulario GET: la URL conserva
 * los criterios y no lleva ningún dato personal.
 */

const MOTIVOS: Record<string, string> = {
  YA_REGISTRADO: 'Ya estaba registrado ese día',
  CREDENCIAL_REVOCADA: 'Credencial revocada',
  ALUMNO_INACTIVO: 'Alumno inactivo',
  ACCESO_BLOQUEADO: 'Acceso del alumno bloqueado',
  SERVICIO_INACTIVO: 'Servicio o recorrido inactivo',
  SIN_INSCRIPCION: 'Sin inscripción activa',
  RECORRIDO_DISTINTO: 'Inscripto en otro recorrido',
}

export type FiltrosVista = {
  dia: string
  resultado: '' | 'REGISTRADO' | 'DENEGADO'
  servicio: string
}

function fechaLarga(dia: string): string {
  const [anio, mes, diaMes] = dia.split('-')
  return `${diaMes}/${mes}/${anio}`
}

function consulta(filtros: FiltrosVista, pagina: number): string {
  const p = new URLSearchParams()
  p.set('dia', filtros.dia)
  if (filtros.resultado) p.set('resultado', filtros.resultado)
  if (filtros.servicio) p.set('servicio', filtros.servicio)
  if (pagina > 1) p.set('pagina', String(pagina))
  return p.toString()
}

export function AuditoriaAccesos({
  filas,
  total,
  pagina,
  tamano,
  filtros,
  servicios,
}: {
  filas: readonly FilaAcceso[]
  total: number
  pagina: number
  tamano: number
  filtros: FiltrosVista
  servicios: readonly ServicioEscaneable[]
}) {
  const router = useRouter()
  const [pendiente, iniciarTransicion] = useTransition()
  const [enviando, setEnviando] = useState(false)
  const [objetivo, setObjetivo] = useState<FilaAcceso | null>(null)
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const areaMotivo = useRef<HTMLTextAreaElement>(null)
  // Safari no da foco a un botón al hacer clic: se recuerda el disparador para devolverle el foco.
  const disparador = useRef<HTMLElement | null>(null)
  const enviandoRef = useRef(false)

  const ocupado = enviando || pendiente
  const paginas = Math.max(1, Math.ceil(total / tamano))

  function marcarEnvio(valor: boolean) {
    enviandoRef.current = valor
    setEnviando(valor)
  }

  function abrir(fila: FilaAcceso, evento: React.MouseEvent<HTMLButtonElement>) {
    disparador.current = evento.currentTarget
    setObjetivo(fila)
    setMotivo('')
    setError(null)
    setAviso(null)
  }

  function cerrarSinOperar() {
    if (enviandoRef.current) return
    setObjetivo(null)
    const origen = disparador.current
    setTimeout(() => origen?.focus(), 0)
  }

  async function confirmar(evento: React.FormEvent) {
    evento.preventDefault()
    if (!objetivo) return
    const texto = motivo.trim()
    if (texto.length < 3 || texto.length > 200) {
      setError('El motivo debe tener entre 3 y 200 caracteres.')
      areaMotivo.current?.focus()
      return
    }
    marcarEnvio(true)
    setError(null)
    const resultado = await anularAccesoRemoto(objetivo.id, texto)
    marcarEnvio(false)
    if (!resultado.ok) {
      setError(resultado.mensaje)
      return
    }
    setObjetivo(null)
    setAviso('Acceso anulado. El registro original se conserva en el historial.')
    iniciarTransicion(() => router.refresh())
  }

  return (
    <div className="space-y-5">
      <form
        method="get"
        className="grid gap-3 rounded-2xl border border-neutral-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Filtros de la auditoría"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="filtro-dia" className="text-sm font-semibold text-neutral-700">
            Día
          </label>
          <input
            id="filtro-dia"
            name="dia"
            type="date"
            defaultValue={filtros.dia}
            required
            className="min-h-11 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="filtro-resultado" className="text-sm font-semibold text-neutral-700">
            Resultado
          </label>
          <select
            id="filtro-resultado"
            name="resultado"
            defaultValue={filtros.resultado}
            className="min-h-11 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
          >
            <option value="">Todos</option>
            <option value="REGISTRADO">Registrados</option>
            <option value="DENEGADO">Denegados</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="filtro-servicio" className="text-sm font-semibold text-neutral-700">
            Servicio o recorrido
          </label>
          <select
            id="filtro-servicio"
            name="servicio"
            defaultValue={filtros.servicio}
            className="min-h-11 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
          >
            <option value="">Todos</option>
            {servicios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <Button type="submit" variant="primary" className="min-h-11 w-full">
            Filtrar
          </Button>
        </div>
      </form>

      <div aria-live="polite" className="min-h-5 text-sm">
        {aviso && !objetivo && (
          <p role="status" className="text-green-800" data-testid="auditoria-aviso">
            {aviso}
          </p>
        )}
      </div>

      <p role="status" className="text-sm text-neutral-600" data-testid="auditoria-total">
        {total === 0
          ? `No hay accesos registrados el ${fechaLarga(filtros.dia)} con estos filtros.`
          : `${total} ${total === 1 ? 'acceso' : 'accesos'} el ${fechaLarga(filtros.dia)}. Página ${pagina} de ${paginas}.`}
      </p>

      {filas.length > 0 && (
        <ul
          className="divide-y divide-neutral-100 overflow-hidden rounded-2xl border border-neutral-200 bg-white"
          aria-label="Accesos registrados"
        >
          {filas.map((fila) => (
            <li key={fila.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between" data-testid="auditoria-fila" data-resultado={fila.resultado} data-anulado={fila.anulado ? 'si' : 'no'}>
              <div className="min-w-0 space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-neutral-900">{fila.hora}</span>
                  <Badge variant={fila.resultado === 'REGISTRADO' ? 'success' : 'warning'} dot>
                    {fila.resultado === 'REGISTRADO' ? 'Registrado' : 'Denegado'}
                  </Badge>
                  {fila.anulado && <Badge variant="outline">Anulado</Badge>}
                  {fila.anonimizado && <Badge variant="outline">Anonimizado</Badge>}
                </div>
                <p className="text-neutral-800">
                  {fila.servicio_nombre}
                  {fila.sentido ? ` · ${fila.sentido === 'IDA' ? 'Ida' : 'Vuelta'}` : ''}
                </p>
                <p className="text-neutral-700 break-words">
                  {fila.anonimizado
                    ? 'Datos de la persona anonimizados'
                    : `${fila.alumno_apellido ?? ''}, ${fila.alumno_nombre ?? ''} · Legajo: ${fila.alumno_legajo ?? 'sin legajo'}`}
                </p>
                {!fila.anonimizado && <p className="text-neutral-600">Operador: {fila.operador_nombre}</p>}
                {fila.motivo_denegacion && (
                  <p className="text-neutral-700">
                    Motivo interno: {MOTIVOS[fila.motivo_denegacion] ?? 'Sin detalle'}
                  </p>
                )}
                {fila.anulado && (
                  <p className="text-neutral-700">
                    Motivo de la anulación: {fila.anulado_motivo ?? 'anonimizado'}
                  </p>
                )}
              </div>
              {fila.resultado === 'REGISTRADO' && !fila.anulado && !fila.anonimizado && (
                <Button
                  type="button"
                  variant="peligro"
                  className="min-h-11 self-start"
                  onClick={(evento) => abrir(fila, evento)}
                  disabled={ocupado}
                  aria-label={`Anular el acceso de las ${fila.hora} de ${fila.alumno_nombre ?? ''} ${fila.alumno_apellido ?? ''}`}
                >
                  <Prohibit size={18} weight="bold" aria-hidden="true" />
                  Anular
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {paginas > 1 && (
        <nav aria-label="Paginación de la auditoría" className="flex items-center justify-between gap-3">
          {pagina > 1 ? (
            <Link
              href={`?${consulta(filtros, pagina - 1)}`}
              className={estilosDeBoton({ variante: 'outline', className: 'min-h-11' })}
            >
              Anterior
            </Link>
          ) : (
            <span />
          )}
          {pagina < paginas ? (
            <Link
              href={`?${consulta(filtros, pagina + 1)}`}
              className={estilosDeBoton({ variante: 'outline', className: 'min-h-11' })}
            >
              Siguiente
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}

      {objetivo && (
        <Dialogo
          tituloId="titulo-anular-acceso"
          titulo="Anular un acceso registrado"
          descripcion="El acceso queda marcado como anulado y deja de contar para el límite de un acceso por día: la persona podrá registrarse de nuevo si corresponde. El registro original no se borra ni se edita."
          selectorFocoInicial="#motivo-anulacion"
          onCerrar={cerrarSinOperar}
        >
          <form onSubmit={confirmar} noValidate className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="motivo-anulacion" className="text-sm font-semibold text-neutral-700">
                Motivo <span className="text-red-600">*</span>
              </label>
              <textarea
                id="motivo-anulacion"
                ref={areaMotivo}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={3}
                maxLength={200}
                required
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'motivo-anulacion-error motivo-anulacion-ayuda' : 'motivo-anulacion-ayuda'}
                className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
              />
              <p id="motivo-anulacion-ayuda" className="text-xs text-neutral-600">
                Entre 3 y 200 caracteres. Queda registrado. Ejemplo: «Se escaneó la credencial de otra persona».
              </p>
              {error && (
                <p id="motivo-anulacion-error" role="alert" className="text-sm text-red-700">
                  {error}
                </p>
              )}
            </div>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" className="min-h-11" onClick={cerrarSinOperar} disabled={ocupado}>
                Cancelar
              </Button>
              <Button type="submit" variant="peligro" className="min-h-11" loading={ocupado}>
                Anular acceso
              </Button>
            </div>
          </form>
        </Dialogo>
      )}
    </div>
  )
}
