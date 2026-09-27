'use client'

import { Badge } from '@/components/ui/Badge'
import type { UsuarioResumen } from '@/services/usuarios-admin.client'

/**
 * Insignias compartidas por el listado y el detalle de Usuarios (EPT-59).
 * Cada una dice su estado en texto: el color nunca es la única señal.
 */

type Variante = 'info' | 'success' | 'warning' | 'default' | 'danger'

const VARIANTE_POR_ROL: Record<string, Variante> = {
  DIRECTOR: 'danger',
  DOCENTE: 'info',
  ESTUDIANTE: 'success',
  PADRE: 'warning',
  PERSONAL: 'default',
}

export function InsigniaRol({ rol }: { rol: string | null }) {
  if (!rol) return <Badge variant="default">Sin rol</Badge>
  return <Badge variant={VARIANTE_POR_ROL[rol] ?? 'default'}>{rol}</Badge>
}

export function InsigniaAcceso({ estado }: { estado: 'HABILITADO' | 'BLOQUEADO' }) {
  return estado === 'BLOQUEADO' ? (
    <Badge variant="danger" dot>Bloqueado</Badge>
  ) : (
    <Badge variant="success" dot>Habilitado</Badge>
  )
}

export type EstadoDeCuenta = 'SIN_CUENTA' | 'NO_ENCONTRADA' | 'BLOQUEADA' | 'NO_CONFIRMADA' | 'ACTIVA'

type IndicadoresDeCuenta = Pick<
  UsuarioResumen,
  'tiene_cuenta' | 'cuenta_existente' | 'correo_confirmado' | 'bloqueo_auth'
>

export function estadoDeCuenta(u: IndicadoresDeCuenta): EstadoDeCuenta {
  if (!u.tiene_cuenta) return 'SIN_CUENTA'
  if (!u.cuenta_existente) return 'NO_ENCONTRADA'
  if (u.bloqueo_auth) return 'BLOQUEADA'
  if (!u.correo_confirmado) return 'NO_CONFIRMADA'
  return 'ACTIVA'
}

export const TEXTO_DE_CUENTA: Record<EstadoDeCuenta, string> = {
  SIN_CUENTA: 'Sin cuenta',
  NO_ENCONTRADA: 'Cuenta no encontrada',
  BLOQUEADA: 'Ingreso bloqueado',
  NO_CONFIRMADA: 'No confirmada',
  ACTIVA: 'Activa',
}

const VARIANTE_DE_CUENTA: Record<EstadoDeCuenta, Variante> = {
  SIN_CUENTA: 'default',
  NO_ENCONTRADA: 'warning',
  BLOQUEADA: 'danger',
  NO_CONFIRMADA: 'warning',
  ACTIVA: 'success',
}

export function InsigniaCuenta({ usuario }: { usuario: IndicadoresDeCuenta }) {
  const estado = estadoDeCuenta(usuario)
  return <Badge variant={VARIANTE_DE_CUENTA[estado]}>{TEXTO_DE_CUENTA[estado]}</Badge>
}

/** Fecha y hora legibles en la zona de la escuela, iguales en servidor y navegador. */
export function formatearFechaHora(valor: string | null): string {
  if (!valor) return '—'
  const fecha = new Date(valor)
  if (Number.isNaN(fecha.getTime())) return '—'
  // 24 h a propósito: en 12 h Node y el navegador usan espacios distintos.
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(fecha)
}

/** Solo la hora (24 h), en la zona de la escuela. */
export function formatearHora(valor: string | null): string {
  if (!valor) return '—'
  const fecha = new Date(valor)
  if (Number.isNaN(fecha.getTime())) return '—'
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(fecha)
}
