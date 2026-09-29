'use client'

import { useState } from 'react'
import {
  DownloadSimple,
  IdentificationBadge,
  Lock,
  Printer,
  Prohibit,
  QrCode,
  UserMinus,
  WarningCircle,
} from '@phosphor-icons/react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { descargarTarjeta } from '@/components/credenciales/descargarTarjeta'
import type { TarjetaCredencial as Tarjeta } from '@/lib/credenciales-qr/tipos'

/**
 * Presentación de la credencial QR (EPT-64, RF20).
 *
 * Componente de PRESENTACIÓN: recibe la tarjeta ya resuelta por el servidor y
 * no decide quién puede verla. La autorización vive en el servidor y en la base;
 * esta pieza solo dibuja lo que esas capas dejaron pasar.
 *
 * La tarjeta muestra nombre, apellido y legajo. NUNCA el DNI ni una foto.
 * La imagen del QR tiene un nombre accesible que identifica a la persona, no al
 * código: el contenido del payload no aparece como texto en ningún atributo.
 *
 * `vista` solo cambia el tratamiento del texto (segunda o tercera persona).
 */

export type VistaCredencial = 'PROPIA' | 'HIJO' | 'DIRECCION'

const FORMATO_FECHA = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'long',
  // Fijar la zona evita que servidor y navegador difieran y rompan la hidratación.
  timeZone: 'America/Argentina/Buenos_Aires',
})

function fechaLarga(iso: string | null): string {
  if (!iso) return ''
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? '' : FORMATO_FECHA.format(fecha)
}

function nombreCompleto(tarjeta: Tarjeta): string {
  return `${tarjeta.alumno.nombre} ${tarjeta.alumno.apellido}`
}

type Aviso = { titulo: string; detalle: string; icono: typeof Lock; tono: string }

/** Texto de cada estado que NO muestra el QR. Dice qué pasa y qué hacer, sin depender del color. */
function avisoDe(tarjeta: Tarjeta, vista: VistaCredencial): Aviso {
  const propia = vista === 'PROPIA'
  switch (tarjeta.estado) {
    case 'SIN_CREDENCIAL':
      return {
        titulo: propia ? 'Todavía no tenés una credencial' : 'Todavía no hay una credencial',
        detalle:
          vista === 'DIRECCION'
            ? 'Este alumno no tiene credencial digital. Emitirla es una acción explícita: no se genera sola.'
            : propia
              ? 'Cuando Dirección la emita, vas a poder verla, descargarla e imprimirla desde acá.'
              : `Cuando Dirección emita la credencial de ${tarjeta.alumno.nombre}, vas a poder verla, descargarla e imprimirla desde acá.`,
        icono: IdentificationBadge,
        tono: 'bg-neutral-100 text-neutral-500',
      }
    case 'REVOCADA':
      return {
        titulo: 'Credencial revocada',
        detalle:
          vista === 'DIRECCION'
            ? 'La última credencial fue revocada y ya no vale. Podés emitir una nueva.'
            : 'Esta credencial fue revocada y ya no vale. Comunicate con Dirección para obtener una nueva.',
        icono: Prohibit,
        tono: 'bg-red-50 text-red-700',
      }
    case 'ALUMNO_INACTIVO':
      return {
        titulo: propia ? 'Estás inactivo' : 'Alumno inactivo',
        detalle:
          vista === 'DIRECCION'
            ? 'La credencial sigue vigente, pero no es válida mientras el alumno esté inactivo. Al reactivarlo vuelve a valer la misma credencial.'
            : propia
              ? 'Tu credencial no es válida mientras estés inactivo. Cuando vuelvas a estar activo, vuelve a valer la misma.'
              : `La credencial de ${tarjeta.alumno.nombre} no es válida mientras esté inactivo. Cuando vuelva a estar activo, vuelve a valer la misma.`,
        icono: UserMinus,
        tono: 'bg-amber-50 text-amber-800',
      }
    case 'ACCESO_BLOQUEADO':
      return {
        titulo: 'Acceso del alumno bloqueado',
        detalle:
          'La credencial sigue vigente, pero no es válida mientras el acceso del alumno esté bloqueado. Al habilitarlo vuelve a valer la misma credencial.',
        icono: Lock,
        tono: 'bg-amber-50 text-amber-800',
      }
    default:
      return {
        titulo: 'Credencial no disponible',
        detalle: 'No pudimos mostrar la credencial.',
        icono: WarningCircle,
        tono: 'bg-neutral-100 text-neutral-500',
      }
  }
}

export function TarjetaCredencial({
  tarjeta,
  vista,
  idTitulo,
}: {
  tarjeta: Tarjeta
  vista: VistaCredencial
  /** Identificador del título de la sección, para `aria-labelledby`. */
  idTitulo: string
}) {
  const [mensaje, setMensaje] = useState<{ tipo: 'estado' | 'error'; texto: string } | null>(null)
  const [descargando, setDescargando] = useState(false)

  const nombre = nombreCompleto(tarjeta)
  const vigente = tarjeta.estado === 'VIGENTE' && tarjeta.qr !== null

  async function alDescargar() {
    if (!tarjeta.qr) return
    setDescargando(true)
    setMensaje({ tipo: 'estado', texto: 'Preparando la descarga…' })
    try {
      await descargarTarjeta({
        nombre: tarjeta.alumno.nombre,
        apellido: tarjeta.alumno.apellido,
        legajo: tarjeta.alumno.legajo_nro,
        qr: tarjeta.qr,
      })
      setMensaje({ tipo: 'estado', texto: 'La descarga comenzó. Buscá la imagen en tus descargas.' })
    } catch {
      setMensaje({
        tipo: 'error',
        texto: 'No pudimos generar la imagen. Volvé a intentarlo.',
      })
    } finally {
      setDescargando(false)
    }
  }

  function alImprimir() {
    setMensaje({ tipo: 'estado', texto: 'Abriendo la impresión…' })
    window.print()
  }

  return (
    <section aria-labelledby={idTitulo} className="space-y-4" data-estado-credencial={tarjeta.estado}>
      {vigente ? (
        <>
          {/* Único bloque que se imprime (ver el @media print de globals.css). */}
          <article
            className="imprimible mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-neutral-300 bg-white shadow-sm"
            aria-label={`Credencial digital de ${nombre}`}
          >
            <div className="flex items-center gap-2 bg-brand-700 px-5 py-3 text-white">
              <QrCode size={22} weight="bold" aria-hidden="true" />
              <p className="text-sm font-bold tracking-wide">Educar para Transformar</p>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-neutral-600">
                  Credencial digital
                </p>
                <p className="mt-1 text-2xl font-extrabold leading-tight text-neutral-900 break-words">
                  {tarjeta.alumno.nombre}
                  <br />
                  {tarjeta.alumno.apellido}
                </p>
                <p className="mt-2 text-sm font-semibold text-neutral-700">
                  Legajo: {tarjeta.alumno.legajo_nro ?? 'sin legajo'}
                </p>
              </div>
              <div className="mx-auto w-full max-w-[16rem] rounded-xl border border-neutral-200 bg-white p-1">
                {/* eslint-disable-next-line @next/next/no-img-element -- URI de datos generada en el servidor */}
                <img
                  src={tarjeta.qr!}
                  alt={`Código QR de la credencial de ${nombre}`}
                  width={256}
                  height={256}
                  className="block h-auto w-full"
                  style={{ imageRendering: 'pixelated' }}
                />
              </div>
              <p className="text-center text-xs text-neutral-600">
                Es un código personal. Mostralo solo cuando te lo pidan y no lo compartas.
              </p>
            </div>
          </article>

          <div className="flex flex-col items-center gap-2">
            <Badge variant="success" dot>
              Credencial vigente
            </Badge>
            {tarjeta.credencial && (
              <p className="text-xs text-neutral-600">
                Emitida el {fechaLarga(tarjeta.credencial.emitida_en)}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button
              type="button"
              variant="primary"
              className="min-h-11"
              onClick={alDescargar}
              loading={descargando}
            >
              <DownloadSimple size={18} weight="bold" aria-hidden="true" />
              Descargar imagen
            </Button>
            <Button type="button" variant="outline" className="min-h-11" onClick={alImprimir}>
              <Printer size={18} weight="bold" aria-hidden="true" />
              Imprimir
            </Button>
          </div>
        </>
      ) : (
        <SinCodigo tarjeta={tarjeta} vista={vista} nombre={nombre} />
      )}

      <div aria-live="polite" className="min-h-5 text-center text-sm">
        {mensaje && (
          <p role={mensaje.tipo === 'error' ? 'alert' : 'status'} className={mensaje.tipo === 'error' ? 'text-red-700' : 'text-neutral-700'}>
            {mensaje.texto}
          </p>
        )}
      </div>
    </section>
  )
}

function SinCodigo({ tarjeta, vista, nombre }: { tarjeta: Tarjeta; vista: VistaCredencial; nombre: string }) {
  const aviso = avisoDe(tarjeta, vista)
  const Icono = aviso.icono
  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-neutral-200 bg-white px-5 py-10 text-center">
      <div className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl ${aviso.tono}`}>
        <Icono size={28} weight="fill" aria-hidden="true" />
      </div>
      <p className="text-xs font-semibold uppercase tracking-widest text-neutral-600">{nombre}</p>
      <p className="mt-1 text-sm text-neutral-600">Legajo: {tarjeta.alumno.legajo_nro ?? 'sin legajo'}</p>
      <h3 className="mt-4 text-lg font-extrabold text-neutral-900">{aviso.titulo}</h3>
      <p className="mx-auto mt-2 max-w-[44ch] text-sm text-neutral-600">{aviso.detalle}</p>
    </div>
  )
}
