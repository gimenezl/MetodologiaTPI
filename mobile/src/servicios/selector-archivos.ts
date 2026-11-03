import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'

import {
  MENSAJE_ARCHIVO,
  TAMANO_MAXIMO_BYTES,
  tipoDesdeNombre,
  validarArchivoDeclarado,
  type TipoComprobante,
} from '@/compartido/comprobantes-contrato'

/**
 * Selección de un comprobante en el dispositivo (EPT-148): foto de la cámara, imagen de la galería o un
 * archivo (PDF o imagen) del almacenamiento.
 *
 * Esto es la comodidad de la interfaz, NO la validación: el servidor lee los bytes y decide. Acá se
 * rechaza lo evidentemente inválido (tipo, vacío, más de 5 MiB, contenido que no es lo que dice ser) para
 * dar un mensaje claro antes de gastar datos.
 *
 * Imágenes: una foto de cámara moderna (12 MP o más) puede superar los 5 MiB aprobados. Antes de validar, la
 * imagen se reduce (lado mayor de 2400 px, suficiente para leer un comprobante) y se recomprime a JPEG. Esa
 * recodificación además descarta los metadatos EXIF (ubicación incluida). Los PDF no se tocan.
 *
 * Privacidad: el archivo vive en el directorio de caché de la aplicación; nunca se persiste la ruta ni el
 * contenido.
 */

export interface ArchivoElegido {
  /** URI local (caché de la aplicación). No sale del dispositivo. */
  uri: string
  nombre: string
  tipo: TipoComprobante
  tamanoBytes: number
}

export type ResultadoSeleccion =
  | { tipo: 'elegido'; archivo: ArchivoElegido }
  | { tipo: 'cancelado' }
  /** `puedePreguntar`: el sistema aún mostrará el diálogo; si es falso, hay que ir a Ajustes. */
  | { tipo: 'permiso_denegado'; puedePreguntar: boolean }
  | { tipo: 'sin_camara' }
  | { tipo: 'invalido'; mensaje: string }
  | { tipo: 'error' }

export interface SelectorArchivos {
  tomarFoto(): Promise<ResultadoSeleccion>
  elegirImagen(): Promise<ResultadoSeleccion>
  elegirArchivo(): Promise<ResultadoSeleccion>
}

interface ActivoCrudo {
  uri: string
  nombre?: string | null
  mimeType?: string | null
  tamano?: number | null
  ancho?: number | null
  alto?: number | null
  /**
   * `siempre`: toda imagen se recomprime (cámara y galería: descarta EXIF y acota el tamaño).
   * `si_excede`: solo si supera el máximo (archivo del almacenamiento: no se altera lo que ya entra).
   */
  recomprimir: 'siempre' | 'si_excede'
}

/** Lado mayor tras la reducción: un comprobante sigue siendo legible y pesa una fracción del original. */
const LADO_MAXIMO_PX = 2400
const CALIDAD_JPEG = 0.8
/** Tope para leer un archivo en memoria al mirar su firma: más que esto no es un comprobante. */
const LECTURA_MAXIMA_BYTES = 64 * 1024 * 1024

/** Firma de los primeros bytes: solo orienta, la verificación real es del servidor. */
export function tipoPorFirma(bytes: Uint8Array): TipoComprobante | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)
  ) {
    return 'image/png'
  }
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return 'application/pdf'
  }
  return null
}

function tipoDeclarado(a: ActivoCrudo): TipoComprobante | null {
  const mime = (a.mimeType ?? '').toLowerCase()
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'image/jpeg'
  if (mime === 'image/png') return 'image/png'
  if (mime === 'application/pdf') return 'application/pdf'
  return a.nombre ? tipoDesdeNombre(a.nombre) : null
}

interface Inspeccion {
  tamano: number
  firma: TipoComprobante | null
  /** Más de lo que se acepta leer en memoria. */
  demasiado: boolean
}

/** Lee el tamaño real y la firma (primeros bytes) del archivo. Lanza si no se puede leer. */
async function inspeccionar(uri: string, tamanoDeclarado: number | null): Promise<Inspeccion | null> {
  const archivo = new File(uri)
  if (!archivo.exists) return null
  const tamano = archivo.size ?? tamanoDeclarado ?? 0
  if (tamano === 0) return { tamano, firma: null, demasiado: false }
  if (tamano > LECTURA_MAXIMA_BYTES) return { tamano, firma: null, demasiado: true }
  const firma = tipoPorFirma(new Uint8Array(await archivo.arrayBuffer()).subarray(0, 16))
  return { tamano, firma, demasiado: false }
}

/** Reduce el lado mayor y recomprime a JPEG. Descarta EXIF. */
async function reducirImagen(uri: string, ancho?: number | null, alto?: number | null): Promise<string> {
  let w = ancho ?? 0
  let h = alto ?? 0
  if (!w || !h) {
    const medida = await ImageManipulator.manipulate(uri).renderAsync()
    w = medida.width
    h = medida.height
  }
  const contexto = ImageManipulator.manipulate(uri)
  if (Math.max(w, h) > LADO_MAXIMO_PX) {
    contexto.resize(w >= h ? { width: LADO_MAXIMO_PX } : { height: LADO_MAXIMO_PX })
  }
  const imagen = await contexto.renderAsync()
  const resultado = await imagen.saveAsync({ compress: CALIDAD_JPEG, format: SaveFormat.JPEG })
  return resultado.uri
}

function nombreJpg(nombre: string | null | undefined): string {
  const base = (nombre ?? '').replace(/\.[^./\\]+$/u, '')
  return `${base.length > 0 ? base : 'comprobante'}.jpg`
}

const MENSAJE_NO_ES_COMPROBANTE = 'El archivo no es una imagen JPG o PNG ni un PDF. Elegí otro archivo.'

/**
 * Imagen de la cámara o de la galería. El sistema puede entregarla en HEIC u otro formato que el contrato no
 * acepta tal cual (un iPhone fotografía en HEIC), así que no se juzga por su firma original: el decodificador
 * nativo es quien confirma que es una imagen (si no puede leerla, no lo es) y el resultado se recodifica a
 * JPEG reducido, que es lo que se valida y se sube.
 */
async function aceptarImagenDelSistema(a: ActivoCrudo): Promise<ResultadoSeleccion> {
  let uri: string
  try {
    uri = await reducirImagen(a.uri, a.ancho, a.alto)
  } catch {
    return { tipo: 'invalido', mensaje: MENSAJE_NO_ES_COMPROBANTE }
  }
  let info: Inspeccion | null
  try {
    info = await inspeccionar(uri, null)
  } catch {
    return { tipo: 'error' }
  }
  if (!info || info.firma !== 'image/jpeg') return { tipo: 'error' }
  const verificacion = validarArchivoDeclarado('image/jpeg', info.tamano)
  if (!verificacion.ok) return { tipo: 'invalido', mensaje: verificacion.mensaje }
  return {
    tipo: 'elegido',
    archivo: { uri, nombre: nombreJpg(a.nombre), tipo: 'image/jpeg', tamanoBytes: info.tamano },
  }
}

/** Valida el archivo elegido con el MISMO contrato que el servidor y lee su firma real. */
async function aceptar(a: ActivoCrudo): Promise<ResultadoSeleccion> {
  if (a.recomprimir === 'siempre') return aceptarImagenDelSistema(a)
  let uri = a.uri
  let nombre = a.nombre ?? null
  let info: Inspeccion | null
  try {
    info = await inspeccionar(uri, a.tamano ?? null)
  } catch {
    return { tipo: 'error' }
  }
  if (!info) return { tipo: 'error' }
  if (info.tamano === 0) return { tipo: 'invalido', mensaje: MENSAJE_ARCHIVO.ARCHIVO_VACIO }
  if (info.demasiado) return { tipo: 'invalido', mensaje: MENSAJE_ARCHIVO.ARCHIVO_DEMASIADO_GRANDE }

  // Los bytes mandan: si no empiezan como JPEG, PNG o PDF, el archivo no es un comprobante aunque su
  // nombre o su tipo declarado digan otra cosa.
  if (!info.firma) return { tipo: 'invalido', mensaje: MENSAJE_NO_ES_COMPROBANTE }
  const declarado = tipoDeclarado(a)
  if (declarado && declarado !== info.firma) {
    return {
      tipo: 'invalido',
      mensaje: 'El contenido del archivo no coincide con su tipo. Elegí otro archivo.',
    }
  }

  let firma: TipoComprobante = info.firma
  let tamano = info.tamano
  const esImagen = firma !== 'application/pdf'
  if (esImagen && tamano > TAMANO_MAXIMO_BYTES) {
    try {
      uri = await reducirImagen(uri, a.ancho, a.alto)
      const reducida = await inspeccionar(uri, null)
      if (!reducida || reducida.firma !== 'image/jpeg') return { tipo: 'error' }
      firma = 'image/jpeg'
      tamano = reducida.tamano
      nombre = nombreJpg(nombre)
    } catch {
      return { tipo: 'error' }
    }
  }

  const verificacion = validarArchivoDeclarado(firma, tamano)
  if (!verificacion.ok) return { tipo: 'invalido', mensaje: verificacion.mensaje }
  return {
    tipo: 'elegido',
    archivo: {
      uri,
      nombre:
        nombre && nombre.length > 0
          ? nombre
          : `comprobante.${firma === 'application/pdf' ? 'pdf' : firma === 'image/png' ? 'png' : 'jpg'}`,
      tipo: firma,
      tamanoBytes: tamano,
    },
  }
}

async function desdeImagePicker(resultado: ImagePicker.ImagePickerResult): Promise<ResultadoSeleccion> {
  if (resultado.canceled || !resultado.assets || resultado.assets.length === 0) return { tipo: 'cancelado' }
  const a = resultado.assets[0]
  return aceptar({
    uri: a.uri,
    nombre: a.fileName,
    mimeType: a.mimeType,
    tamano: a.fileSize,
    ancho: a.width,
    alto: a.height,
    recomprimir: 'siempre',
  })
}

const OPCIONES_IMAGEN: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: false,
  allowsMultipleSelection: false,
  // No devolver EXIF a la aplicación; el archivo se recodifica después (ver `reducirImagen`).
  exif: false,
  // Un `quality` menor a 1 hace que iOS convierta HEIC a JPEG.
  quality: 0.85,
  // iOS: entregar un formato compatible (JPEG) en lugar del original (HEIC).
  preferredAssetRepresentationMode: 'compatible' as unknown as ImagePicker.UIImagePickerPreferredAssetRepresentationMode,
}

export function crearSelectorArchivos(): SelectorArchivos {
  return {
    async tomarFoto() {
      try {
        let permiso = await ImagePicker.getCameraPermissionsAsync()
        if (!permiso.granted) {
          if (!permiso.canAskAgain) return { tipo: 'permiso_denegado', puedePreguntar: false }
          permiso = await ImagePicker.requestCameraPermissionsAsync()
          if (!permiso.granted) return { tipo: 'permiso_denegado', puedePreguntar: permiso.canAskAgain }
        }
        return await desdeImagePicker(await ImagePicker.launchCameraAsync(OPCIONES_IMAGEN))
      } catch {
        // Sin cámara (o simulador): el selector la rechaza. No es un error del archivo.
        return { tipo: 'sin_camara' }
      }
    },
    async elegirImagen() {
      try {
        return await desdeImagePicker(await ImagePicker.launchImageLibraryAsync(OPCIONES_IMAGEN))
      } catch {
        return { tipo: 'error' }
      }
    },
    async elegirArchivo() {
      try {
        const r = await DocumentPicker.getDocumentAsync({
          type: ['application/pdf', 'image/jpeg', 'image/png'],
          // Copia a la caché de la aplicación: el original del usuario nunca se toca ni se borra.
          copyToCacheDirectory: true,
          multiple: false,
        })
        if (r.canceled || !r.assets || r.assets.length === 0) return { tipo: 'cancelado' }
        const a = r.assets[0]
        return await aceptar({ uri: a.uri, nombre: a.name, mimeType: a.mimeType, tamano: a.size, recomprimir: 'si_excede' })
      } catch {
        return { tipo: 'error' }
      }
    },
  }
}
