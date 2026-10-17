import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { AppState, Linking, ScrollView, Text, View } from 'react-native'

import { Aviso, Boton, CampoTexto, EstadoPantalla, Formulario, MarcoPantalla, PantallaConVolver, Tarjeta } from '@/catalogo'
import { entornoDelBundle } from '@/configuracion/entorno'
import { obtenerTransporteApi } from '@/servicios/api'
import { crearAlmacenamientoSeguro } from '@/servicios/almacenamiento-seguro'
import { crearSelectorArchivos } from '@/servicios/selector-archivos'
import { crearSubidaExpo } from '@/servicios/subida-archivo'
import type { TransporteHttp } from '@/servicios/transporte-http'
import { ControladorAutenticacion, estadoVisible, type EstadoAutenticacion } from '@/servicios/autenticacion'
import { alLiberarRecuperacion } from '@/servicios/recuperacion-activa'
import { obtenerClienteSupabase, vincularCicloDeVida } from '@/servicios/supabase'
import { color, espacio, estiloDeTexto } from '@/tokens'

import { CONTEXTO_CUOTAS_VACIO, CuotasContenedor, type ContextoCuotas } from '../cuotas/CuotasContenedor'
import { CambioContrasenaContenedor } from '../recuperacion/CambioContrasenaContenedor'
import { cargarDatosRol, type DatosRol } from './datos-rol'

const INICIAL: EstadoAutenticacion = { tipo: 'cargando' }

export interface AccesoContenedorProps {
  /** Abre la solicitud del correo de recuperación (ruta propia con su navegación nativa). */
  alRecuperarContrasena?: () => void
}

export function AccesoContenedor({ alRecuperarContrasena }: AccesoContenedorProps = {}): ReactElement {
  const entorno = useMemo(() => entornoDelBundle(), [])
  const cliente = useMemo(() => entorno.ok ? obtenerClienteSupabase() : null, [entorno])
  const [estadoReal, setEstadoReal] = useState<EstadoAutenticacion>(INICIAL)
  const [ultimaAutenticada, setUltimaAutenticada] = useState<Extract<EstadoAutenticacion, { tipo: 'autenticada' }> | null>(null)
  // Un refresco de token del mismo usuario no desmonta la pantalla: ver `estadoVisible`.
  const estado = estadoVisible(estadoReal, ultimaAutenticada)
  const [correo, setCorreo] = useState('')
  const [contrasena, setContrasena] = useState('')
  const [errorIngreso, setErrorIngreso] = useState<string>()
  const [errorCorreo, setErrorCorreo] = useState<string>()
  const [errorContrasena, setErrorContrasena] = useState<string>()
  const [enviando, setEnviando] = useState(false)
  const [mostrarContrasena, setMostrarContrasena] = useState(false)
  const [resultadoDatosRol, setResultadoDatosRol] = useState<
    | { clave: string; datos: DatosRol }
    | { clave: string; error: true }
    | null
  >(null)
  const [seccion, setSeccion] = useState<{ clave: string; nombre: 'principal' | 'cuotas' | 'cuenta' } | null>(null)
  const [contextoCuotas, setContextoCuotas] = useState<{ clave: string; contexto: ContextoCuotas } | null>(null)
  const [cambioContrasena, setCambioContrasena] = useState<{ clave: string } | null>(null)
  const [errorEnlaceWeb, setErrorEnlaceWeb] = useState(false)
  const estadoRealActual = useRef<EstadoAutenticacion>(INICIAL)
  useEffect(() => {
    estadoRealActual.current = estadoReal
  }, [estadoReal])
  const controlador = useMemo(() => cliente ? new ControladorAutenticacion(cliente, {
    cambiar: siguiente => {
      if (siguiente.tipo === 'autenticada') setUltimaAutenticada(siguiente)
      else if (siguiente.tipo !== 'revalidando') setUltimaAutenticada(null)
      setEstadoReal(siguiente)
    },
  }) : null, [cliente])
  // Recuperación de un intento de pago incierto: almacenamiento cifrado del dispositivo, acotado por usuario.
  const almacenamientoPagos = useMemo(() => crearAlmacenamientoSeguro(), [])
  // Carga de comprobantes (EPT-109): el transporte se resuelve al usarlo, no al montar (la finalización
  // lee, valida y publica un archivo y tiene un límite de tiempo propio).
  const comprobantes = useMemo(() => {
    const transporte: TransporteHttp = {
      solicitar: (ruta, solicitud) => obtenerTransporteApi(60_000).solicitar(ruta, solicitud),
    }
    return { transporte, selector: crearSelectorArchivos(), subir: crearSubidaExpo() }
  }, [])

  useEffect(() => {
    if (!cliente || !controlador) return
    const liberarCiclo = vincularCicloDeVida(cliente)
    const detener = controlador.iniciar()
    const appState = AppState.addEventListener('change', siguiente => {
      if (siguiente === 'active') void controlador.revalidar()
    })
    // Una recuperación de contraseña (otra pantalla) pudo reemplazar la sesión guardada o dejarla igual:
    // solo se vuelve a validar el acceso cuando cambió, para no desmontar lo que la persona estaba haciendo.
    const alTerminarRecuperacion = alLiberarRecuperacion(({ sesionAlterada }) => {
      const tipo = estadoRealActual.current.tipo
      if (sesionAlterada || tipo === 'cargando' || tipo === 'revalidando') void controlador.revalidar()
    })
    return () => {
      alTerminarRecuperacion()
      appState.remove()
      detener()
      liberarCiclo()
    }
  }, [cliente, controlador])

  useEffect(() => {
    if (estado.tipo !== 'autenticada' || !cliente || (estado.rol !== 'PADRE' && estado.rol !== 'ESTUDIANTE')) return
    let vigente = true
    const clave = `${estado.usuarioId}:${estado.rol}`
    void cargarDatosRol(cliente, estado.usuarioId, estado.rol).then(datos => {
      if (vigente) setResultadoDatosRol({ clave, datos })
    }).catch(() => {
      if (vigente) setResultadoDatosRol({ clave, error: true })
    })
    return () => { vigente = false }
  }, [cliente, estado])

  const ingresar = async () => {
    if (enviando || !controlador) return
    const correoNormalizado = correo.trim()
    const contrasenaEnviada = contrasena
    const correoInvalido = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(correoNormalizado)
    const contrasenaVacia = contrasena.length === 0
    setErrorCorreo(correoNormalizado.length === 0 ? 'Ingresá tu correo electrónico.' : correoInvalido ? 'Ingresá un correo electrónico válido.' : undefined)
    setErrorContrasena(contrasenaVacia ? 'Ingresá tu contraseña.' : undefined)
    if (correoInvalido || contrasenaVacia) return
    setEnviando(true)
    setErrorIngreso(undefined)
    // No retener ni capturar credenciales en pantallas posteriores o evidencia de fallo.
    setCorreo('')
    setContrasena('')
    try {
      await controlador.ingresar(correoNormalizado, contrasenaEnviada)
    } catch (causa) {
      setErrorIngreso(causa instanceof Error ? causa.message : 'No se pudo iniciar sesión. Revisá el correo y la contraseña.')
    } finally {
      setEnviando(false)
    }
  }

  if (!cliente || !controlador) {
    return <MarcoPantalla><View style={{ flex: 1, padding: espacio.xl, justifyContent: 'center' }}><Text accessibilityRole="header" style={[estiloDeTexto('titulo'), { color: color.neutro800 }]}>Aplicación no configurada</Text><Aviso tipo="advertencia" titulo="Falta configuración pública" mensaje={entorno.ok ? 'No se pudo inicializar el servicio de autenticación.' : entorno.motivos.join(' ')} anuncio="alerta" /></View></MarcoPantalla>
  }

  if (estado.tipo === 'cargando') {
    return <MarcoPantalla><EstadoPantalla tipo="cargando" mensaje="Comprobando la sesión…" /></MarcoPantalla>
  }
  if (estado.tipo === 'revalidando') {
    return <MarcoPantalla><EstadoPantalla tipo="cargando" mensaje="Verificando tu cuenta y permisos…" /></MarcoPantalla>
  }
  if (estado.tipo === 'error_conexion') {
    return <MarcoPantalla><Formulario titulo="No pudimos verificar el acceso" accionPrincipal={{ etiqueta: 'Reintentar', onPress: () => void controlador.revalidar() }}><Aviso tipo="advertencia" titulo="Conexión no disponible" mensaje={estado.mensaje} anuncio="estado" /></Formulario></MarcoPantalla>
  }
  if (estado.tipo === 'sin_perfil' || estado.tipo === 'bloqueada' || estado.tipo === 'rol_no_admitido') {
    const copy = estado.tipo === 'sin_perfil'
      ? ['Perfil no disponible', 'La cuenta no tiene un perfil habilitado en el sistema. Contactá a la institución.']
      : estado.tipo === 'bloqueada'
        ? ['Acceso bloqueado', 'La cuenta no está habilitada para ingresar. Contactá a la institución.']
        : ['Acceso no disponible', 'El perfil no tiene un rol compatible con esta aplicación. Contactá a la institución.']
    return <MarcoPantalla><Formulario titulo={copy[0]} accionPrincipal={{ etiqueta: 'Volver al inicio de sesión', onPress: () => void controlador.salir() }}><Aviso tipo="advertencia" titulo={copy[0]} mensaje={copy[1]} anuncio="alerta" /></Formulario></MarcoPantalla>
  }
  if (estado.tipo === 'autenticada') {
    const soloWeb = estado.rol === 'DIRECTOR' || estado.rol === 'DOCENTE' || estado.rol === 'PERSONAL'
    // La clave (usuario + rol) y no la identidad del estado: una revalidación o un refresh de token
    // no debe reiniciar la sección ni el contexto de la pantalla, pero otro usuario sí los descarta.
    const clave = `${estado.usuarioId}:${estado.rol}`
    const resultado = resultadoDatosRol?.clave === clave ? resultadoDatosRol : null
    const datosRol = resultado && 'datos' in resultado ? resultado.datos : null
    const seccionActual = seccion?.clave === clave ? seccion.nombre : 'principal'
    const contextoActual = contextoCuotas?.clave === clave ? contextoCuotas.contexto : CONTEXTO_CUOTAS_VACIO
    // Las pantallas internas de Cuotas (detalle, pago, comprobantes) traen su propia flecha: este marco solo
    // cubre «Cuotas» y «Mi cuenta» en su nivel raíz, que vuelven a la sección principal.
    const enSubpantalla = Boolean(contextoActual.abierta || contextoActual.pago || contextoActual.comprobante)
    const cambiandoContrasena = cambioContrasena?.clave === clave
    return (
      <MarcoPantalla>
        <Formulario titulo={soloWeb ? 'Continuá desde el sistema web' : 'Tu cuenta móvil'} accionPrincipal={{ etiqueta: 'Cerrar sesión', onPress: () => void controlador.salir() }}>
          {soloWeb ? (
            <>
              <Aviso tipo="informativo" titulo="Esta cuenta usa el sistema web" mensaje="Por seguridad, los perfiles de Dirección, Docencia y Personal no tienen funciones habilitadas en la aplicación móvil." anuncio="estado" />
              <Boton etiqueta="Abrir sistema institucional" variante="enlace" onPress={() => {
                setErrorEnlaceWeb(false)
                const destino = entorno.ok ? new URL(entorno.entorno.apiBaseUrl).origin : ''
                void Linking.openURL(destino).catch(() => setErrorEnlaceWeb(true))
              }} />
              {errorEnlaceWeb ? <Aviso tipo="error" mensaje="No se pudo abrir el sistema institucional. Intentá nuevamente." anuncio="alerta" /> : null}
            </>
          ) : (
            <>
              {/* Deslizable de izquierda a derecha: en pantallas angostas o con texto ampliado no entran todas. */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                accessibilityRole="tablist"
                contentContainerStyle={{ flexDirection: 'row', gap: espacio.sm, paddingRight: espacio.lg }}
                style={{ flexGrow: 0 }}
              >
                <Boton etiqueta={estado.rol === 'PADRE' ? 'Hijos vinculados' : 'Mi información'} variante={seccionActual === 'principal' ? 'primario' : 'secundario'} onPress={() => setSeccion({ clave, nombre: 'principal' })} />
                <Boton etiqueta="Cuotas" variante={seccionActual === 'cuotas' ? 'primario' : 'secundario'} onPress={() => setSeccion({ clave, nombre: 'cuotas' })} testID="seccion-cuotas" />
                <Boton etiqueta="Mi cuenta" variante={seccionActual === 'cuenta' ? 'primario' : 'secundario'} onPress={() => setSeccion({ clave, nombre: 'cuenta' })} />
              </ScrollView>
              <PantallaConVolver
                activo={seccionActual !== 'principal' && !enSubpantalla && !cambiandoContrasena}
                onVolver={() => setSeccion({ clave, nombre: 'principal' })}
              >
              {seccionActual === 'cuenta' ? (
                cambiandoContrasena ? (
                  <CambioContrasenaContenedor
                    key={estado.usuarioId}
                    cliente={cliente}
                    usuarioId={estado.usuarioId}
                    onVolver={() => setCambioContrasena(null)}
                    onSesionExpirada={() => {
                      setCambioContrasena(null)
                      void controlador.revalidar()
                    }}
                  />
                ) : (
                  <>
                    <Tarjeta>
                      <Text accessibilityRole="header" style={[estiloDeTexto('seccion'), { color: color.neutro800 }]}>Cuenta verificada</Text>
                      <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Rol institucional: {estado.rol === 'PADRE' ? 'Familia' : 'Estudiante'}.</Text>
                    </Tarjeta>
                    <Tarjeta>
                      <Text accessibilityRole="header" style={[estiloDeTexto('seccion'), { color: color.neutro800 }]}>Seguridad</Text>
                      <Boton etiqueta="Cambiar contraseña" variante="secundario" testID="cambiar-contrasena" onPress={() => setCambioContrasena({ clave })} />
                    </Tarjeta>
                  </>
                )
              ) : seccionActual === 'cuotas' ? (
                !resultado ? (
                  <EstadoPantalla tipo="cargando" mensaje="Cargando información autorizada…" />
                ) : 'error' in resultado || !datosRol ? (
                  <EstadoPantalla tipo="error" titulo="No pudimos cargar la información" descripcion="La sesión sigue sin mostrar datos hasta poder validarlos." onReintentar={() => void controlador.revalidar()} />
                ) : (
                  <CuotasContenedor
                    key={estado.usuarioId}
                    contexto={contextoActual}
                    onContexto={contexto => setContextoCuotas({ clave, contexto })}
                    cliente={cliente}
                    pagos={datosRol.rol === 'PADRE' ? { usuarioId: estado.usuarioId, almacenamiento: almacenamientoPagos } : undefined}
                    comprobantes={datosRol.rol === 'PADRE' ? comprobantes : undefined}
                    mostrarSelector={datosRol.rol === 'PADRE'}
                    alumnos={datosRol.rol === 'PADRE'
                      ? datosRol.hijos.map(hijo => ({ id: hijo.id, etiqueta: [hijo.nombre, hijo.apellido].filter(Boolean).join(' ') || 'Estudiante' }))
                      : [{ id: datosRol.alumno.id, etiqueta: 'Mis cuotas' }]}
                  />
                )
              ) : !resultado ? (
                <EstadoPantalla tipo="cargando" mensaje="Cargando información autorizada…" />
              ) : 'error' in resultado ? (
                <EstadoPantalla tipo="error" titulo="No pudimos cargar la información" descripcion="La sesión sigue sin mostrar datos hasta poder validarlos." onReintentar={() => void controlador.revalidar()} />
              ) : datosRol?.rol === 'PADRE' ? (
                <>
                  <Text accessibilityRole="header" style={[estiloDeTexto('seccion'), { color: color.neutro800 }]}>Hijos vinculados</Text>
                  {datosRol.hijos.length === 0 ? (
                    <EstadoPantalla tipo="vacio" titulo="Todavía no hay estudiantes vinculados" descripcion="Cuando la institución registre un vínculo familiar autorizado, aparecerá en esta sección." />
                  ) : datosRol.hijos.map(hijo => (
                    <Tarjeta key={hijo.id}>
                      <Text accessibilityRole="header" style={[estiloDeTexto('seccion'), { color: color.neutro800 }]}>{[hijo.nombre, hijo.apellido].filter(Boolean).join(' ')}</Text>
                      <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Legajo: {hijo.legajo_nro ?? 'No disponible'}</Text>
                      <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Estado: {hijo.estado ?? 'No disponible'}</Text>
                      <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Curso: {[hijo.curso_denominacion, hijo.curso_division].filter(Boolean).join(' ') || 'Sin curso informado'}</Text>
                      <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Nivel: {hijo.nivel_nombre ?? 'No disponible'}</Text>
                    </Tarjeta>
                  ))}
                </>
              ) : datosRol?.rol === 'ESTUDIANTE' ? (
                <Tarjeta>
                  <Text accessibilityRole="header" style={[estiloDeTexto('seccion'), { color: color.neutro800 }]}>Mi información académica</Text>
                  <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Estudiante: {[datosRol.alumno.nombre, datosRol.alumno.apellido].filter(Boolean).join(' ') || 'No disponible'}</Text>
                  <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Legajo: {datosRol.alumno.legajo_nro ?? 'No disponible'}</Text>
                  <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Estado: {datosRol.alumno.estado ?? 'No disponible'}</Text>
                  <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Curso: {[datosRol.alumno.curso_denominacion, datosRol.alumno.curso_division].filter(Boolean).join(' ') || 'Sin curso informado'}</Text>
                  <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Nivel: {datosRol.alumno.nivel_nombre ?? 'No disponible'}</Text>
                </Tarjeta>
              ) : null}
              </PantallaConVolver>
            </>
          )}
        </Formulario>
      </MarcoPantalla>
    )
  }

  return (
    <MarcoPantalla>
      <Formulario titulo="Iniciar sesión" resumenErrores={errorIngreso ? 'No se pudo validar el ingreso.' : undefined} accionPrincipal={{ etiqueta: 'Ingresar', onPress: () => void ingresar(), cargando: enviando }}>
        <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Usá la cuenta que ya utilizás en el sistema institucional.</Text>
        <CampoTexto etiqueta="Correo electrónico" valor={correo} onChangeText={texto => { setCorreo(texto); setErrorCorreo(undefined) }} teclado="correo" accionTeclado="siguiente" placeholder="nombre@institucion.edu.ar" testID="correo" error={errorCorreo} deshabilitado={enviando} />
        <CampoTexto etiqueta="Contraseña" valor={contrasena} onChangeText={texto => { setContrasena(texto); setErrorContrasena(undefined) }} error={errorContrasena} secreto controlMostrar={{ visible: mostrarContrasena, onToggle: () => setMostrarContrasena(v => !v) }} accionTeclado="enviar" onSubmitEditing={ingresar} testID="contrasena" deshabilitado={enviando} />
        {errorIngreso ? <Aviso tipo="error" titulo="No se pudo iniciar sesión" mensaje={errorIngreso} anuncio="alerta" /> : null}
        {alRecuperarContrasena ? (
          <Boton etiqueta="¿Olvidaste tu contraseña?" variante="enlace" testID="olvide-contrasena" onPress={alRecuperarContrasena} deshabilitado={enviando} />
        ) : null}
      </Formulario>
      <View style={{ height: espacio.md }} />
    </MarcoPantalla>
  )
}
