import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useForm, useWatch } from 'react-hook-form'

import { entornoDelBundle } from '@/configuracion/entorno'
import { crearAlmacenamientoSeguro } from '@/servicios/almacenamiento-seguro'
import { obtenerClienteSupabase, vincularCicloDeVida } from '@/servicios/supabase'
import { verificarAlmacenamiento } from '@/servicios/verificacion-almacenamiento'

import { esquemaVerificacion, type DatosVerificacion } from './esquema'
import { VerificacionVista, type EstadoSesionVista, type ResultadoVista } from './VerificacionVista'

/** Contenedor: obtiene datos y decide; la vista solo dibuja. */
export function VerificacionContenedor(): ReactElement {
  const entorno = useMemo(() => entornoDelBundle(), [])
  const [estadoSesion, setEstadoSesion] = useState<EstadoSesionVista>(entorno.ok ? 'consultando' : 'no_configurada')
  const [resultado, setResultado] = useState<ResultadoVista>({ tipo: 'ninguno' })
  const almacenamiento = useMemo(() => crearAlmacenamientoSeguro(), [])

  const { control, handleSubmit, formState, setValue } = useForm<DatosVerificacion>({
    resolver: zodResolver(esquemaVerificacion),
    defaultValues: { tamanoKb: '6' },
    mode: 'onSubmit',
  })
  const tamanoKb = useWatch({ control, name: 'tamanoKb' })

  useEffect(() => {
    if (!entorno.ok) return
    let activo = true
    const cliente = obtenerClienteSupabase()
    const liberar = vincularCicloDeVida(cliente)
    cliente.auth
      .getSession()
      .then(({ data }) => {
        if (activo) setEstadoSesion(data.session ? 'con_sesion' : 'sin_sesion')
      })
      .catch(() => {
        if (activo) setEstadoSesion('sin_sesion')
      })
    return () => {
      activo = false
      liberar()
    }
  }, [entorno.ok])

  const ejecutar = handleSubmit(async datos => {
    try {
      const r = await verificarAlmacenamiento(almacenamiento, Number(datos.tamanoKb))
      setResultado(r.ok ? { tipo: 'ok', bytes: r.bytes } : { tipo: 'fallo' })
    } catch {
      setResultado({ tipo: 'fallo' })
    }
  })

  return (
    <VerificacionVista
      entornoValido={entorno.ok}
      motivosEntorno={entorno.ok ? [] : entorno.motivos}
      estadoSesion={estadoSesion}
      tamanoKb={tamanoKb}
      errorTamano={formState.errors.tamanoKb?.message}
      resultado={resultado}
      ejecutando={formState.isSubmitting}
      onCambiarTamano={texto => {
        setValue('tamanoKb', texto, { shouldValidate: formState.isSubmitted })
      }}
      onEjecutar={() => void ejecutar()}
    />
  )
}
