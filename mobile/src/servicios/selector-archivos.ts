import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
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
 * Privacidad: el archivo vive en el directorio de caché de la aplicación; nunca se persiste la ruta ni el
 * contenido. La imagen se sube tal como la entrega el sistema: puede conservar metadatos EXIF (ver el README).
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
}

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

/** Valida el archivo elegido con el MISMO contrato que el servidor y lee su firma real. */
async function aceptar(a: ActivoCrudo): Promise<ResultadoSeleccion> {
  const archivo = new File(a.uri)
  let tamano = a.tamano ?? null
  let firma: TipoComprobante | null
  try {
    if (!archivo.exists) return { tipo: 'error' }
    tamano = archivo.size ?? tamano
    // Sin leer el archivo entero: un tamaño fuera de rango ya se rechaza y evita cargar un archivo enorme.
    if (tamano === 0) return { tipo: 'invalido', mensaje: MENSAJE_ARCHIVO.ARCHIVO_VACIO }
    if ((tamano ?? 0) > TAMANO_MAXIMO_BYTES) {
      return { tipo: 'invalido', mensaje: MENSAJE_ARCHIVO.ARCHIVO_DEMASIADO_GRANDE }
    }
    // Hasta 5 MiB: se lee con `File.arrayBuffer()` y se mira la firma (los primeros bytes).
    firma = tipoPorFirma(new Uint8Array(await archivo.arrayBuffer()).subarray(0, 16))
  } catch {
    return { tipo: 'error' }
  }
  // Los bytes mandan: si no empiezan como JPEG, PNG o PDF, el archivo no es un comprobante aunque su
  // nombre o su tipo declarado digan otra cosa.
  if (!firma) {
    return {
      tipo: 'invalido',
      mensaje: 'El archivo no es una imagen JPG o PNG ni un PDF. Elegí otro archivo.',
    }
  }
  const declarado = tipoDeclarado(a)
  if (declarado && declarado !== firma) {
    return {
      tipo: 'invalido',
      mensaje: 'El contenido del archivo no coincide con su tipo. Elegí otro archivo.',
    }
  }
  const tipo = firma
  const verificacion = validarArchivoDeclarado(tipo, tamano ?? 0)
  if (!verificacion.ok) return { tipo: 'invalido', mensaje: verificacion.mensaje }
  if ((tamano ?? 0) > TAMANO_MAXIMO_BYTES) {
    return { tipo: 'invalido', mensaje: 'El archivo supera el máximo de 5 MB.' }
  }
  return {
    tipo: 'elegido',
    archivo: {
      uri: a.uri,
      nombre: a.nombre && a.nombre.length > 0 ? a.nombre : `comprobante.${tipo === 'application/pdf' ? 'pdf' : tipo === 'image/png' ? 'png' : 'jpg'}`,
      tipo,
      tamanoBytes: tamano as number,
    },
  }
}

async function desdeImagePicker(resultado: ImagePicker.ImagePickerResult): Promise<ResultadoSeleccion> {
  if (resultado.canceled || !resultado.assets || resultado.assets.length === 0) return { tipo: 'cancelado' }
  const a = resultado.assets[0]
  return aceptar({ uri: a.uri, nombre: a.fileName, mimeType: a.mimeType, tamano: a.fileSize })
}

const OPCIONES_IMAGEN: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: false,
  allowsMultipleSelection: false,
  // No devolver EXIF a la aplicación. No lo quita del archivo: eso exigiría recodificar la imagen.
  exif: false,
  // Un `quality` menor a 1 hace que iOS convierta HEIC a JPEG.
  quality: 0.85,
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
        return await aceptar({ uri: a.uri, nombre: a.name, mimeType: a.mimeType, tamano: a.size })
      } catch {
        return { tipo: 'error' }
      }
    },
  }
}
