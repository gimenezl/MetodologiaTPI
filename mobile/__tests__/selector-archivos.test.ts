import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'

import { crearSelectorArchivos, tipoPorFirma } from '@/servicios/selector-archivos'

// Simulacros de los módulos nativos: esta prueba valida NUESTRA lógica de selección. No prueba el
// selector del sistema operativo ni la cámara real (eso lo cubre la ejecución en dispositivo/emulador).
jest.mock('expo-image-picker', () => ({
  getCameraPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}))
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }))

let mockArchivo: { exists: boolean; size: number | null; cabecera: number[] }
jest.mock('expo-file-system', () => ({
  File: class {
    get exists() {
      return mockArchivo.exists
    }
    get size() {
      return mockArchivo.size
    }
    async arrayBuffer() {
      return new Uint8Array(mockArchivo.cabecera).buffer
    }
  },
}))

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]
const HTML = Array.from(Buffer.from('<html><body>'))

const camara = ImagePicker.getCameraPermissionsAsync as jest.Mock
const pedirCamara = ImagePicker.requestCameraPermissionsAsync as jest.Mock
const lanzarCamara = ImagePicker.launchCameraAsync as jest.Mock
const lanzarGaleria = ImagePicker.launchImageLibraryAsync as jest.Mock
const documento = DocumentPicker.getDocumentAsync as jest.Mock

beforeEach(() => {
  jest.resetAllMocks()
  mockArchivo = { exists: true, size: 2048, cabecera: JPEG }
})

describe('tipoPorFirma', () => {
  it('reconoce los tres formatos por sus primeros bytes y nada más', () => {
    expect(tipoPorFirma(new Uint8Array(JPEG))).toBe('image/jpeg')
    expect(tipoPorFirma(new Uint8Array(PNG))).toBe('image/png')
    expect(tipoPorFirma(new Uint8Array(PDF))).toBe('application/pdf')
    expect(tipoPorFirma(new Uint8Array(HTML))).toBeNull()
    expect(tipoPorFirma(new Uint8Array([]))).toBeNull()
    expect(tipoPorFirma(new Uint8Array([0xff, 0xd8]))).toBeNull()
  })
})

describe('cámara', () => {
  it('pide el permiso y devuelve una foto válida', async () => {
    camara.mockResolvedValue({ granted: false, canAskAgain: true })
    pedirCamara.mockResolvedValue({ granted: true, canAskAgain: true })
    lanzarCamara.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///c/f.jpg', fileName: 'f.jpg', mimeType: 'image/jpeg', fileSize: 2048 }],
    })
    const r = await crearSelectorArchivos().tomarFoto()
    expect(r).toEqual({
      tipo: 'elegido',
      archivo: { uri: 'file:///c/f.jpg', nombre: 'f.jpg', tipo: 'image/jpeg', tamanoBytes: 2048 },
    })
    // Sin EXIF (ni ubicación) y con recompresión (HEIC → JPEG en iOS).
    expect(lanzarCamara.mock.calls[0][0]).toMatchObject({ exif: false, mediaTypes: ['images'], allowsEditing: false })
  })

  it('permiso denegado: informa si todavía se puede preguntar', async () => {
    camara.mockResolvedValue({ granted: false, canAskAgain: true })
    pedirCamara.mockResolvedValue({ granted: false, canAskAgain: false })
    expect(await crearSelectorArchivos().tomarFoto()).toEqual({ tipo: 'permiso_denegado', puedePreguntar: false })
    camara.mockResolvedValue({ granted: false, canAskAgain: false })
    expect(await crearSelectorArchivos().tomarFoto()).toEqual({ tipo: 'permiso_denegado', puedePreguntar: false })
    expect(pedirCamara).toHaveBeenCalledTimes(1)
    expect(lanzarCamara).not.toHaveBeenCalled()
  })

  it('un dispositivo sin cámara no es un error del archivo', async () => {
    camara.mockResolvedValue({ granted: true, canAskAgain: true })
    lanzarCamara.mockRejectedValue(new Error('Camera not available on simulator'))
    expect(await crearSelectorArchivos().tomarFoto()).toEqual({ tipo: 'sin_camara' })
  })

  it('cancelar no devuelve un archivo', async () => {
    camara.mockResolvedValue({ granted: true, canAskAgain: true })
    lanzarCamara.mockResolvedValue({ canceled: true, assets: null })
    expect(await crearSelectorArchivos().tomarFoto()).toEqual({ tipo: 'cancelado' })
  })
})

describe('galería y archivos', () => {
  it('una imagen cuyo contenido no es lo que dice su extensión se rechaza antes de enviarla', async () => {
    mockArchivo.cabecera = HTML
    lanzarGaleria.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///c/falsa.jpg', fileName: 'falsa.jpg', mimeType: 'image/jpeg', fileSize: 100 }],
    })
    const r = await crearSelectorArchivos().elegirImagen()
    expect(r).toMatchObject({ tipo: 'invalido' })
  })

  it('declarar JPEG con contenido PNG se rechaza como contradictorio', async () => {
    mockArchivo.cabecera = PNG
    lanzarGaleria.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///c/x.jpg', fileName: 'x.jpg', mimeType: 'image/jpeg', fileSize: 100 }],
    })
    expect(await crearSelectorArchivos().elegirImagen()).toEqual({
      tipo: 'invalido',
      mensaje: 'El contenido del archivo no coincide con su tipo. Elegí otro archivo.',
    })
  })

  it('un PDF del almacenamiento se acepta con su nombre y tamaño reales', async () => {
    mockArchivo = { exists: true, size: 4096, cabecera: PDF }
    documento.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///c/t.pdf', name: 'transferencia.pdf', mimeType: 'application/pdf', size: 4096 }],
    })
    const r = await crearSelectorArchivos().elegirArchivo()
    expect(r).toEqual({
      tipo: 'elegido',
      archivo: { uri: 'file:///c/t.pdf', nombre: 'transferencia.pdf', tipo: 'application/pdf', tamanoBytes: 4096 },
    })
    // Se copia a la caché: el original del usuario no se toca.
    expect(documento.mock.calls[0][0]).toMatchObject({ copyToCacheDirectory: true, multiple: false })
  })

  it('un archivo de más de 5 MiB o vacío se rechaza con un mensaje claro', async () => {
    documento.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///c/g.pdf', name: 'g.pdf', mimeType: 'application/pdf', size: 5242881 }],
    })
    mockArchivo = { exists: true, size: 5242881, cabecera: PDF }
    expect(await crearSelectorArchivos().elegirArchivo()).toEqual({
      tipo: 'invalido',
      mensaje: 'El archivo supera el máximo de 5 MB.',
    })
    mockArchivo = { exists: true, size: 0, cabecera: PDF }
    documento.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///c/v.pdf', name: 'v.pdf', mimeType: 'application/pdf', size: 0 }],
    })
    expect(await crearSelectorArchivos().elegirArchivo()).toEqual({ tipo: 'invalido', mensaje: 'El archivo está vacío.' })
  })

  it('exactamente 5 MiB se acepta', async () => {
    mockArchivo = { exists: true, size: 5242880, cabecera: PDF }
    documento.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///c/j.pdf', name: 'j.pdf', mimeType: 'application/pdf', size: 5242880 }],
    })
    expect(await crearSelectorArchivos().elegirArchivo()).toMatchObject({ tipo: 'elegido' })
  })

  it('un archivo ilegible o inexistente es un error, no un archivo válido', async () => {
    mockArchivo = { exists: false, size: null, cabecera: [] }
    documento.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'content://x', name: 'x.pdf', mimeType: 'application/pdf', size: 10 }],
    })
    expect(await crearSelectorArchivos().elegirArchivo()).toEqual({ tipo: 'error' })
  })

  it('un fallo del selector del sistema es un error', async () => {
    documento.mockRejectedValue(new Error('boom'))
    expect(await crearSelectorArchivos().elegirArchivo()).toEqual({ tipo: 'error' })
  })
})
