import type { Metadata } from 'next'
import { requerirDirector } from '@/services/autorizacion'
import { AccesoRestringido } from '../_components/AccesoRestringido'
import { CuentasYPerfiles } from './_components/CuentasYPerfiles'
import { GestionUsuarios } from './_components/GestionUsuarios'

export const metadata: Metadata = {
  title: 'Usuarios | Panel',
}

export const dynamic = 'force-dynamic'

/**
 * Usuarios, protegido en el servidor (EPT-59). La guarda se resuelve antes de
 * entregar la pantalla: un perfil bloqueado o sin rol DIRECTOR recibe «Acceso
 * restringido» y el componente del cliente nunca se monta.
 *
 * La pantalla combina el listado «Cuentas y perfiles» (EPT-59), que lleva al
 * detalle de cada persona, con el alta de cuentas y el listado de edición
 * rápida que ya existían (EPT-9).
 */
export default async function UsuariosPage() {
  const autorizacion = await requerirDirector('Solo la dirección puede gestionar usuarios.')
  if (!autorizacion.autorizado) return <AccesoRestringido mensaje={autorizacion.mensaje} />
  return <GestionUsuarios seccionCuentas={<CuentasYPerfiles />} />
}
