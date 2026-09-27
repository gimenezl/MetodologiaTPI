'use client'

import Link from 'next/link'
import { useEffect, useId, useState } from 'react'
import { CaretLeft, CaretRight, IdentificationBadge, WarningCircle } from '@phosphor-icons/react'
import { Skeleton } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { mensajeParaMostrar } from '@/lib/errores'
import {
  listarUsuarios,
  type PaginaDeUsuarios,
  type UsuarioResumen,
} from '@/services/usuarios-admin.client'
import { InsigniaAcceso, InsigniaCuenta, InsigniaRol } from './etiquetas'

const MENSAJE_CARGA = 'No pudimos cargar las cuentas y perfiles. Intentá nuevamente.'

type Estado =
  | { clave: string; datos: PaginaDeUsuarios; error?: undefined }
  | { clave: string; error: string; datos?: undefined }

/**
 * Listado «Cuentas y perfiles» de Usuarios (EPT-59).
 *
 * Lee `GET /api/usuarios` con búsqueda y paginación: la API vuelve a exigir un
 * Director habilitado y nunca devuelve el correo completo. Tabla desde 768 px y
 * tarjetas en pantallas angostas; cada persona enlaza a su detalle, donde se
 * administran datos, rol, acceso, cuenta e historial.
 */
export function CuentasYPerfiles() {
  const idTitulo = useId()
  const [busqueda, setBusqueda] = useState('')
  const [busquedaAplicada, setBusquedaAplicada] = useState('')
  const [pagina, setPagina] = useState(1)
  const [intento, setIntento] = useState(0)
  const [estado, setEstado] = useState<Estado | null>(null)

  const clave = `${busquedaAplicada}\u0000${pagina}\u0000${intento}`
  const cargando = estado?.clave !== clave

  // La búsqueda espera 300 ms sin escribir y vuelve a la primera página.
  useEffect(() => {
    const temporizador = setTimeout(() => {
      setBusquedaAplicada(busqueda.trim())
      setPagina(1)
    }, 300)
    return () => clearTimeout(temporizador)
  }, [busqueda])

  useEffect(() => {
    let vigente = true
    listarUsuarios(busquedaAplicada, pagina)
      .then((datos) => {
        if (vigente) setEstado({ clave, datos })
      })
      .catch((error: unknown) => {
        if (vigente) setEstado({ clave, error: mensajeParaMostrar(error, MENSAJE_CARGA) })
      })
    return () => {
      vigente = false
    }
  }, [clave, busquedaAplicada, pagina])

  const datos = !cargando ? estado?.datos : undefined
  const error = !cargando ? estado?.error : undefined
  const totalPaginas = datos ? Math.max(1, Math.ceil(datos.total / datos.por_pagina)) : 1

  return (
    <section
      id="cuentas-y-perfiles"
      aria-labelledby={idTitulo}
      className="bg-white rounded-2xl border border-neutral-200 overflow-hidden min-w-0"
    >
      <div className="px-4 sm:px-5 py-4 border-b border-neutral-100 space-y-3">
        <div className="flex items-center gap-2">
          <IdentificationBadge size={18} weight="fill" className="text-brand-600" aria-hidden="true" />
          <h2 id={idTitulo} className="font-bold text-neutral-900 text-sm">
            Cuentas y perfiles
          </h2>
        </div>
        <p className="text-sm text-neutral-600">
          Elegí una persona para ver sus datos, cambiar su rol, bloquear o reactivar su acceso y
          vincularle una cuenta.
        </p>
        <div className="max-w-md">
          <Input
            id="buscar-cuentas"
            label="Buscar por nombre, apellido, DNI o legajo"
            type="search"
            value={busqueda}
            maxLength={100}
            autoComplete="off"
            onChange={(evento) => setBusqueda(evento.target.value)}
          />
        </div>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {cargando
          ? 'Cargando cuentas y perfiles…'
          : datos
            ? `${datos.total === 1 ? 'Se encontró 1 persona' : `Se encontraron ${datos.total} personas`}.`
            : ''}
      </p>

      {error ? (
        <div role="alert" className="m-4 sm:m-5 bg-red-50 border border-red-200 rounded-xl p-4 flex flex-wrap gap-3 items-start">
          <WarningCircle size={20} weight="fill" className="text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-red-800">No pudimos cargar el listado</p>
            <p className="text-sm text-red-700 mt-1 break-words">{error}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setIntento((n) => n + 1)}>
            Reintentar
          </Button>
        </div>
      ) : cargando ? (
        <EsqueletoDelListado />
      ) : datos && datos.usuarios.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <p className="text-sm font-semibold text-neutral-800">
            {busquedaAplicada ? 'Ninguna persona coincide con la búsqueda' : 'Todavía no hay personas registradas'}
          </p>
          <p className="text-sm text-neutral-600 mt-1">
            {busquedaAplicada
              ? 'Revisá lo que escribiste o buscá por DNI.'
              : 'Podés crear la primera con el formulario de alta.'}
          </p>
        </div>
      ) : datos ? (
        <>
          <TablaDeCuentas usuarios={datos.usuarios} />
          <TarjetasDeCuentas usuarios={datos.usuarios} />
          <nav
            aria-label="Paginación de cuentas y perfiles"
            className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3 border-t border-neutral-100"
          >
            <p className="text-sm text-neutral-600">
              Página {datos.pagina} de {totalPaginas} · {datos.total}{' '}
              {datos.total === 1 ? 'persona' : 'personas'}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={datos.pagina <= 1}
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
              >
                <CaretLeft size={14} aria-hidden="true" />
                Anterior
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={datos.pagina >= totalPaginas}
                onClick={() => setPagina((p) => p + 1)}
              >
                Siguiente
                <CaretRight size={14} aria-hidden="true" />
              </Button>
            </div>
          </nav>
        </>
      ) : null}
    </section>
  )
}

function enlaceDetalle(usuario: UsuarioResumen) {
  return `/dashboard/usuarios/${usuario.id}`
}

function TablaDeCuentas({ usuarios }: { usuarios: UsuarioResumen[] }) {
  return (
    <div className="hidden md:block overflow-x-auto">
      <table className="w-full text-sm" aria-label="Cuentas y perfiles">
        <thead>
          <tr className="bg-neutral-50 border-b border-neutral-100">
            {['Nombre y apellido', 'DNI', 'Rol', 'Acceso', 'Cuenta', 'Correo'].map((columna) => (
              <th
                key={columna}
                scope="col"
                className="text-left px-4 py-3 text-xs font-semibold text-neutral-600 uppercase tracking-wider"
              >
                {columna}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {usuarios.map((usuario) => (
            <tr key={usuario.id} className="hover:bg-neutral-50 transition-colors">
              <td className="px-4 py-3">
                <Link
                  href={enlaceDetalle(usuario)}
                  className="font-semibold text-brand-700 hover:text-brand-900 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
                >
                  {usuario.nombre} {usuario.apellido}
                </Link>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-neutral-700">{usuario.dni}</td>
              <td className="px-4 py-3"><InsigniaRol rol={usuario.rol} /></td>
              <td className="px-4 py-3"><InsigniaAcceso estado={usuario.estado_acceso} /></td>
              <td className="px-4 py-3"><InsigniaCuenta usuario={usuario} /></td>
              <td className="px-4 py-3 text-neutral-700 break-all">{usuario.correo_enmascarado ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TarjetasDeCuentas({ usuarios }: { usuarios: UsuarioResumen[] }) {
  return (
    <ul className="md:hidden divide-y divide-neutral-100" aria-label="Cuentas y perfiles">
      {usuarios.map((usuario) => (
        <li key={usuario.id} className="px-4 py-4 space-y-2 min-w-0">
          <Link
            href={enlaceDetalle(usuario)}
            className="block font-semibold text-brand-700 hover:underline underline-offset-2 break-words focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
          >
            {usuario.nombre} {usuario.apellido}
          </Link>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-neutral-600">DNI</dt>
            <dd className="font-mono text-xs text-neutral-800 self-center">{usuario.dni}</dd>
            <dt className="text-neutral-600">Rol</dt>
            <dd><InsigniaRol rol={usuario.rol} /></dd>
            <dt className="text-neutral-600">Acceso</dt>
            <dd><InsigniaAcceso estado={usuario.estado_acceso} /></dd>
            <dt className="text-neutral-600">Cuenta</dt>
            <dd><InsigniaCuenta usuario={usuario} /></dd>
            <dt className="text-neutral-600">Correo</dt>
            <dd className="text-neutral-800 break-all">{usuario.correo_enmascarado ?? '—'}</dd>
          </dl>
        </li>
      ))}
    </ul>
  )
}

function EsqueletoDelListado() {
  return (
    <div aria-hidden="true" className="p-4 sm:p-5 space-y-3">
      {Array.from({ length: 5 }).map((_, fila) => (
        <div key={fila} className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((__, celda) => (
            <Skeleton key={celda} className={celda > 1 ? 'hidden md:block h-5' : 'h-5'} />
          ))}
        </div>
      ))}
    </div>
  )
}
