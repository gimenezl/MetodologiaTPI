'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { mensajeParaMostrar } from '@/lib/errores'
import { actualizarDatosPersonalesSchema } from '@/lib/validations'
import {
  actualizarDatosPersonales,
  ErrorDeUsuarios,
  type DatosPersonales,
  type DetalleDeUsuario,
} from '@/services/usuarios-admin.client'

const MENSAJE_FALLO = 'No pudimos guardar los datos personales. Volvé a intentarlo en unos minutos.'
const CAMPOS = ['nombre', 'apellido', 'dni', 'fecha_nacimiento', 'telefono', 'direccion', 'legajo_nro'] as const
type Campo = (typeof CAMPOS)[number]

function inicial(detalle: DetalleDeUsuario): Record<Campo, string> {
  return {
    nombre: detalle.nombre,
    apellido: detalle.apellido,
    dni: detalle.dni,
    fecha_nacimiento: detalle.fecha_nacimiento ?? '',
    telefono: detalle.telefono ?? '',
    direccion: detalle.direccion ?? '',
    legajo_nro: detalle.legajo_nro ?? '',
  }
}

/**
 * Datos personales editables (EPT-59): las mismas columnas y validaciones que
 * Legajos. Un dato opcional vacío se envía como `null`, que lo borra.
 */
export function SeccionDatosPersonales({
  detalle,
  onGuardado,
}: {
  detalle: DetalleDeUsuario
  onGuardado: () => void
}) {
  const [valores, setValores] = useState(() => inicial(detalle))
  const [errores, setErrores] = useState<Partial<Record<Campo, string>>>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const cambiar = (campo: Campo) => (evento: React.ChangeEvent<HTMLInputElement>) => {
    const valor = evento.target.value
    setValores((previos) => ({ ...previos, [campo]: valor }))
  }

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault()
    if (guardando) return
    setErrores({})
    setErrorGeneral(null)
    setExito(null)

    const vacioANulo = (valor: string) => (valor.trim() === '' ? null : valor.trim())
    const datos: DatosPersonales = {
      nombre: valores.nombre.trim(),
      apellido: valores.apellido.trim(),
      dni: valores.dni.trim(),
      fecha_nacimiento: vacioANulo(valores.fecha_nacimiento),
      telefono: vacioANulo(valores.telefono),
      direccion: vacioANulo(valores.direccion),
      legajo_nro: vacioANulo(valores.legajo_nro),
    }

    const analisis = actualizarDatosPersonalesSchema.safeParse(datos, {
      error: () => 'Revisá este dato.',
    })
    if (!analisis.success) {
      const nuevos: Partial<Record<Campo, string>> = {}
      for (const problema of analisis.error.issues) {
        const campo = problema.path[0]
        if (typeof campo === 'string' && (CAMPOS as readonly string[]).includes(campo) && !nuevos[campo as Campo]) {
          nuevos[campo as Campo] = problema.message
        }
      }
      setErrores(nuevos)
      return
    }

    setGuardando(true)
    try {
      await actualizarDatosPersonales(detalle.id, datos)
      setExito('Datos personales guardados.')
      onGuardado()
    } catch (error) {
      const mensaje = mensajeParaMostrar(error, MENSAJE_FALLO)
      if (error instanceof ErrorDeUsuarios && error.campo && (CAMPOS as readonly string[]).includes(error.campo)) {
        setErrores({ [error.campo as Campo]: mensaje })
      } else {
        setErrorGeneral(mensaje)
      }
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={guardar} noValidate className="space-y-4" aria-label="Datos personales">
      <div className="grid sm:grid-cols-2 gap-4">
        <Input id="datos-nombre" label="Nombre" required value={valores.nombre} onChange={cambiar('nombre')} error={errores.nombre} maxLength={100} />
        <Input id="datos-apellido" label="Apellido" required value={valores.apellido} onChange={cambiar('apellido')} error={errores.apellido} maxLength={100} />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <Input id="datos-dni" label="DNI" required inputMode="numeric" maxLength={8} value={valores.dni} onChange={cambiar('dni')} error={errores.dni} />
        <Input id="datos-fecha-nacimiento" label="Fecha de nacimiento" type="date" value={valores.fecha_nacimiento} onChange={cambiar('fecha_nacimiento')} error={errores.fecha_nacimiento} />
      </div>
      <div className="grid sm:grid-cols-3 gap-4">
        <Input id="datos-telefono" label="Teléfono" value={valores.telefono} onChange={cambiar('telefono')} error={errores.telefono} maxLength={20} />
        <Input id="datos-direccion" label="Dirección" value={valores.direccion} onChange={cambiar('direccion')} error={errores.direccion} maxLength={255} />
        <Input id="datos-legajo" label="Legajo" value={valores.legajo_nro} onChange={cambiar('legajo_nro')} error={errores.legajo_nro} maxLength={50} />
      </div>
      <div role="status" aria-live="polite" className="empty:hidden">
        {exito && <p className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">{exito}</p>}
      </div>
      <div role="alert" aria-live="assertive" className="empty:hidden">
        {errorGeneral && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{errorGeneral}</p>}
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={guardando}>
          Guardar datos personales
        </Button>
      </div>
    </form>
  )
}
