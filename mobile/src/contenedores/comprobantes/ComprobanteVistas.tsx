import type { ReactElement } from 'react'
import { Image, Text, View } from 'react-native'

import { Aviso, Boton, CampoTexto, EstadoPantalla, Importe, InsigniaEstado, Tarjeta } from '@/catalogo'
import type { CargaComprobante, PagoPendienteDelPadre } from '@/servicios/comprobantes'
import type { ArchivoElegido } from '@/servicios/selector-archivos'
import { color, espacio, estiloDeTexto } from '@/tokens'

export function formatearTamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

/** `AAAA-MM-DD` → `DD/MM/AAAA` para mostrar. No interpreta zonas horarias: es una fecha civil. */
export function fechaParaMostrar(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

const codigoCorto = (id: string): string => id.slice(0, 8).toUpperCase()

// ---- Lista de pagos pendientes -------------------------------------------------------------------------

export type CargaPagos =
  | { tipo: 'cargando' }
  | { tipo: 'error' }
  | { tipo: 'ok'; pagos: PagoPendienteDelPadre[] }

export interface ListaPagosVistaProps {
  etiquetaAlumno: string
  carga: CargaPagos
  onElegir: (pagoId: string) => void
  onVolver: () => void
  onReintentar: () => void
}

export function ListaPagosVista(props: ListaPagosVistaProps): ReactElement {
  const { carga } = props
  return (
    <View style={{ gap: espacio.md }}>
      <Text accessibilityRole="header" style={[estiloDeTexto('titulo'), { color: color.neutro800 }]}>
        Comprobantes de transferencia
      </Text>
      <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Estudiante: {props.etiquetaAlumno}</Text>

      {carga.tipo === 'cargando' ? <EstadoPantalla tipo="cargando" mensaje="Cargando tus pagos pendientes…" /> : null}
      {carga.tipo === 'error' ? (
        <EstadoPantalla
          tipo="error"
          titulo="No pudimos cargar tus pagos"
          descripcion="Revisá tu conexión e intentá nuevamente."
          onReintentar={props.onReintentar}
        />
      ) : null}
      {carga.tipo === 'ok' && carga.pagos.length === 0 ? (
        <EstadoPantalla
          tipo="vacio"
          titulo="No hay pagos pendientes de verificación"
          descripcion="Cuando registres un pago por transferencia, podrás adjuntar acá su comprobante."
        />
      ) : null}
      {carga.tipo === 'ok'
        ? carga.pagos.map(pago => (
            <View key={pago.pagoId} testID={`pago-pendiente-${pago.pagoId}`}>
              <Tarjeta>
                <Text accessibilityRole="header" style={[estiloDeTexto('seccion'), { color: color.neutro800 }]}>
                  Pago {codigoCorto(pago.pagoId)}
                </Text>
                <InsigniaEstado dominio="pago" estado="pendiente" />
                <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Total a transferir</Text>
                <Importe centavos={pago.totalCentavos} total />
                <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>
                  {pago.archivos === 0
                    ? 'Sin comprobantes cargados.'
                    : pago.archivos === 1
                      ? '1 comprobante cargado.'
                      : `${pago.archivos} comprobantes cargados.`}
                </Text>
                <Boton
                  etiqueta="Adjuntar comprobante"
                  onPress={() => props.onElegir(pago.pagoId)}
                  testID={`adjuntar-${pago.pagoId}`}
                />
              </Tarjeta>
            </View>
          ))
        : null}
      <Boton etiqueta="Volver a las cuotas" variante="enlace" onPress={props.onVolver} testID="volver-cuotas-comprobante" />
    </View>
  )
}

// ---- Formulario ----------------------------------------------------------------------------------------

export type EtapaEnvio = 'preparando' | 'subiendo' | 'verificando'

export interface ErroresCampos {
  fecha?: string
  importe?: string
  numero?: string
  archivo?: string
}

export interface FormularioComprobanteVistaProps {
  etiquetaAlumno: string
  pago: PagoPendienteDelPadre
  fecha: string
  importe: string
  numero: string
  errores: ErroresCampos
  archivo: ArchivoElegido | null
  /** Avisos de la selección (permiso denegado, sin cámara…). */
  avisoSeleccion: { tipo: 'advertencia' | 'error'; mensaje: string } | null
  enviando: boolean
  etapa: EtapaEnvio | null
  progreso: number
  mensaje: string | null
  onCambiarFecha: (v: string) => void
  onCambiarImporte: (v: string) => void
  onCambiarNumero: (v: string) => void
  onTomarFoto: () => void
  onElegirImagen: () => void
  onElegirArchivo: () => void
  onQuitarArchivo: () => void
  onEnviar: () => void
  onVolver: () => void
}

const TEXTO_ETAPA: Record<EtapaEnvio, string> = {
  preparando: 'Preparando el envío…',
  subiendo: 'Subiendo el archivo…',
  verificando: 'Verificando el archivo en el servidor…',
}

export function FormularioComprobanteVista(props: FormularioComprobanteVistaProps): ReactElement {
  const { pago, archivo, errores } = props
  const datos = pago.datosTransferencia
  const bloqueado = props.enviando
  const porcentaje = Math.round(props.progreso * 100)

  return (
    <View style={{ gap: espacio.md }}>
      <Text accessibilityRole="header" style={[estiloDeTexto('titulo'), { color: color.neutro800 }]}>
        Adjuntar comprobante
      </Text>
      <Tarjeta>
        <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Estudiante: {props.etiquetaAlumno}</Text>
        <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Pago {codigoCorto(pago.pagoId)}</Text>
        <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Total calculado por la institución</Text>
        <Importe centavos={pago.totalCentavos} total />
        <InsigniaEstado dominio="pago" estado="pendiente" />
      </Tarjeta>

      <Aviso
        tipo="informativo"
        mensaje="Adjuntar un comprobante no aprueba el pago ni cambia tu saldo: la institución lo verifica y recién entonces se acredita."
        anuncio="estado"
      />

      {datos ? (
        <Tarjeta>
          <Text accessibilityRole="header" style={[estiloDeTexto('seccion'), { color: color.neutro800 }]}>
            Datos de la transferencia
          </Text>
          <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>
            Fecha: {fechaParaMostrar(datos.fecha)}
          </Text>
          <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Importe informado</Text>
          <Importe centavos={datos.importeCentavos} />
          <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>
            Número de operación: {datos.numero}
          </Text>
          <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>
            Ya están informados: un archivo nuevo no los modifica.
          </Text>
        </Tarjeta>
      ) : (
        <View style={{ gap: espacio.md }}>
          <Text accessibilityRole="header" style={[estiloDeTexto('seccion'), { color: color.neutro800 }]}>
            Datos de la transferencia
          </Text>
          <CampoTexto
            etiqueta="Fecha de la transferencia"
            ayuda="Formato DD/MM/AAAA, por ejemplo 14/10/2026."
            valor={props.fecha}
            onChangeText={props.onCambiarFecha}
            error={errores.fecha}
            teclado="numerico"
            deshabilitado={bloqueado}
            accionTeclado="siguiente"
            testID="campo-fecha"
          />
          <CampoTexto
            etiqueta="Importe transferido"
            ayuda="Puede diferir del total calculado: la institución lo revisa. Por ejemplo 15000,50."
            valor={props.importe}
            onChangeText={props.onCambiarImporte}
            error={errores.importe}
            teclado="decimal"
            deshabilitado={bloqueado}
            accionTeclado="siguiente"
            testID="campo-importe"
          />
          <CampoTexto
            etiqueta="Número de operación"
            ayuda="Figura en el comprobante de tu banco."
            valor={props.numero}
            onChangeText={props.onCambiarNumero}
            error={errores.numero}
            deshabilitado={bloqueado}
            accionTeclado="listo"
            testID="campo-numero"
          />
        </View>
      )}

      <Text accessibilityRole="header" style={[estiloDeTexto('seccion'), { color: color.neutro800 }]}>
        Archivo del comprobante
      </Text>
      <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>
        Imagen JPG o PNG, o PDF, de hasta 5 MB.
      </Text>

      {archivo ? (
        <Tarjeta>
          {archivo.tipo !== 'application/pdf' ? (
            <Image
              testID="vista-previa"
              source={{ uri: archivo.uri }}
              accessibilityLabel="Vista previa del comprobante elegido"
              resizeMode="contain"
              style={{ width: '100%', height: 200, backgroundColor: color.neutro100 }}
            />
          ) : (
            <Text testID="vista-previa-pdf" style={[estiloDeTexto('seccion'), { color: color.neutro800 }]}>
              Documento PDF
            </Text>
          )}
          <Text testID="archivo-elegido" style={[estiloDeTexto('cuerpo'), { color: color.neutro800 }]}>
            {archivo.nombre} · {formatearTamano(archivo.tamanoBytes)}
          </Text>
          <Boton
            etiqueta="Quitar archivo"
            variante="secundario"
            onPress={props.onQuitarArchivo}
            deshabilitado={bloqueado}
            testID="quitar-archivo"
          />
        </Tarjeta>
      ) : null}
      {errores.archivo ? <Aviso tipo="error" mensaje={errores.archivo} anuncio="alerta" /> : null}
      {props.avisoSeleccion ? <Aviso tipo={props.avisoSeleccion.tipo} mensaje={props.avisoSeleccion.mensaje} anuncio="alerta" /> : null}

      <View style={{ gap: espacio.sm }}>
        <Boton etiqueta="Tomar foto" variante="secundario" onPress={props.onTomarFoto} deshabilitado={bloqueado} testID="tomar-foto" />
        <Boton etiqueta="Elegir una imagen de la galería" variante="secundario" onPress={props.onElegirImagen} deshabilitado={bloqueado} testID="elegir-imagen" />
        <Boton etiqueta="Elegir un PDF o archivo" variante="secundario" onPress={props.onElegirArchivo} deshabilitado={bloqueado} testID="elegir-archivo" />
      </View>

      {props.enviando && props.etapa ? (
        <View style={{ gap: espacio.sm }}>
          <Text accessibilityLiveRegion="polite" style={[estiloDeTexto('cuerpo'), { color: color.neutro800 }]}>
            {TEXTO_ETAPA[props.etapa]}
            {props.etapa === 'subiendo' ? ` ${porcentaje} %` : ''}
          </Text>
          <View
            testID="progreso-envio"
            accessibilityRole="progressbar"
            accessibilityLabel="Progreso del envío"
            accessibilityValue={{ min: 0, max: 100, now: props.etapa === 'preparando' ? 0 : porcentaje }}
            style={{ height: 10, borderRadius: 5, backgroundColor: color.neutro200, overflow: 'hidden' }}
          >
            <View style={{ width: `${props.etapa === 'preparando' ? 0 : porcentaje}%`, height: 10, backgroundColor: color.primario500 }} />
          </View>
        </View>
      ) : null}
      {props.mensaje ? <Aviso tipo="error" mensaje={props.mensaje} anuncio="alerta" /> : null}

      <Boton
        etiqueta="Enviar comprobante"
        onPress={props.onEnviar}
        cargando={props.enviando}
        deshabilitado={!archivo && !props.enviando}
        pistaAccesible={archivo ? 'Envía el archivo para su verificación' : 'Elegí primero un archivo'}
        testID="enviar-comprobante"
      />
      <Boton etiqueta="Volver" variante="enlace" onPress={props.onVolver} deshabilitado={bloqueado} testID="volver-lista-comprobantes" />
    </View>
  )
}

// ---- Resultado -----------------------------------------------------------------------------------------

export type ResultadoComprobante =
  | { tipo: 'confirmado'; carga: CargaComprobante }
  | { tipo: 'rechazado'; mensaje: string }
  | { tipo: 'incierto'; verificando: boolean; fallo: boolean }

export interface ResultadoComprobanteVistaProps {
  resultado: ResultadoComprobante
  onAdjuntarOtro: () => void
  onVerificar: () => void
  onReintentar: () => void
  onVolverACuotas: () => void
}

export function ResultadoComprobanteVista(props: ResultadoComprobanteVistaProps): ReactElement {
  const { resultado } = props
  if (resultado.tipo === 'confirmado') {
    const { carga } = resultado
    return (
      <View style={{ gap: espacio.md }}>
        <Text accessibilityRole="header" style={[estiloDeTexto('titulo'), { color: color.neutro800 }]}>
          Comprobante enviado
        </Text>
        <Aviso
          tipo="exito"
          titulo="Comprobante recibido: pendiente de verificación."
          mensaje="La institución lo revisará. Tu saldo no cambia hasta que apruebe el pago."
          anuncio="estado"
        />
        {carga.repetido ? (
          <Aviso tipo="informativo" mensaje="Este comprobante ya estaba registrado: no se duplicó." anuncio="estado" />
        ) : null}
        <Tarjeta>
          <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>
            Fecha de la transferencia: {fechaParaMostrar(carga.fechaTransferencia)}
          </Text>
          <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>Importe informado</Text>
          <Importe centavos={carga.importeCentavos} />
          <Text style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>
            Número de operación: {carga.numeroOperacion}
          </Text>
          <Text testID="cantidad-comprobantes" style={[estiloDeTexto('cuerpo'), { color: color.neutro700 }]}>
            Comprobantes del pago: {carga.cantidadArchivos}
          </Text>
          <InsigniaEstado dominio="pago" estado="pendiente" />
        </Tarjeta>
        <Boton etiqueta="Adjuntar otro comprobante" variante="secundario" onPress={props.onAdjuntarOtro} testID="adjuntar-otro" />
        <Boton etiqueta="Volver a las cuotas" onPress={props.onVolverACuotas} testID="volver-cuotas-comprobante" />
      </View>
    )
  }

  if (resultado.tipo === 'rechazado') {
    return (
      <View style={{ gap: espacio.md }}>
        <Text accessibilityRole="header" style={[estiloDeTexto('titulo'), { color: color.neutro800 }]}>
          No se registró el comprobante
        </Text>
        <Aviso tipo="advertencia" titulo="No registramos nada." mensaje={resultado.mensaje} anuncio="alerta" />
        <Boton etiqueta="Volver a intentar" onPress={props.onReintentar} testID="reintentar-comprobante" />
        <Boton etiqueta="Volver a las cuotas" variante="enlace" onPress={props.onVolverACuotas} testID="volver-cuotas-comprobante" />
      </View>
    )
  }

  return (
    <View style={{ gap: espacio.md }}>
      <Text accessibilityRole="header" style={[estiloDeTexto('titulo'), { color: color.neutro800 }]}>
        No pudimos confirmar el envío
      </Text>
      <Aviso
        tipo="advertencia"
        titulo="Todavía no sabemos si se registró."
        mensaje="No volvemos a enviarlo hasta comprobarlo, para no duplicar el comprobante. Verificá el resultado."
        anuncio="alerta"
      />
      {resultado.fallo ? (
        <Aviso tipo="error" mensaje="No pudimos verificar el resultado. Revisá tu conexión e intentá nuevamente." anuncio="alerta" />
      ) : null}
      <Boton etiqueta="Verificar resultado" onPress={props.onVerificar} cargando={resultado.verificando} testID="verificar-carga" />
      <Boton
        etiqueta="Volver a las cuotas"
        variante="enlace"
        onPress={props.onVolverACuotas}
        pistaAccesible="La carga queda guardada para verificarla después"
        testID="volver-cuotas-comprobante"
      />
    </View>
  )
}
