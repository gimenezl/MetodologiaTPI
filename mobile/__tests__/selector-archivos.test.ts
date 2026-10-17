import * as DocumentPicker from 'expo-document-picker'
import { ImageManipulator } from 'expo-image-manipulator'
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
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: { manipulate: jest.fn() },
}))

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
const manipular = ImageManipulator.manipulate as jest.Mock

const MiB = 1024 * 1024
/** Cabecera de un HEIC (`ftyp`): lo que entrega un iPhone si no se convierte. */
const HEIC = [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]

// Doble del manipulador de imágenes: la imagen reducida es un JPEG de 900 KB en `reducida.jpg`.
let reducir: { redimensionar: jest.Mock; guardar: jest.Mock; ancho: number; alto: number; tamanoFinal: number }
beforeEach(() => {
  jest.resetAllMocks()
  mockArchivo = { exists: true, size: 2048, cabecera: JPEG }
  reducir = { redimensionar: jest.fn(), guardar: jest.fn(), ancho: 4032, alto: 3024, tamanoFinal: 900_000 }
  manipular.mockImplementation(() => ({
    resize: reducir.redimensionar,
    renderAsync: async () => ({
      width: reducir.ancho,
      height: reducir.alto,
      saveAsync: async (opciones: unknown) => {
        reducir.guardar(opciones)
        mockArchivo = { exists: true, size: reducir.tamanoFinal, cabecera: JPEG }
        return { uri: 'file:///c/reducida.jpg', width: 2400, height: 1800 }
      },
    }),
  }))
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
      assets: [{ uri: 'file:///c/f.jpg', fileName: 'f.jpg', mimeType: 'image/jpeg', fileSize: 2048, width: 1600, height: 1200 }],
    })
    const r = await crearSelectorArchivos().tomarFoto()
    // Siempre se recomprime (descarta EXIF): lo que se sube es la imagen reducida.
    expect(r).toEqual({
      tipo: 'elegido',
      archivo: { uri: 'file:///c/reducida.jpg', nombre: 'f.jpg', tipo: 'image/jpeg', tamanoBytes: 900_000 },
    })
    // Sin EXIF en el resultado, JPEG compatible en iOS (nunca HEIC) y sin recorte ni edición.
    expect(lanzarCamara.mock.calls[0][0]).toMatchObject({
      exif: false,
      mediaTypes: ['images'],
      allowsEditing: false,
      preferredAssetRepresentationMode: 'compatible',
    })
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
  it('una imagen que el sistema no puede decodificar se rechaza antes de enviarla', async () => {
    manipular.mockImplementation(() => {
      throw new Error('formato no decodificable')
    })
    lanzarGaleria.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///c/falsa.jpg', fileName: 'falsa.jpg', mimeType: 'image/jpeg', fileSize: 100 }],
    })
    const r = await crearSelectorArchivos().elegirImagen()
    expect(r).toEqual({
      tipo: 'invalido',
      mensaje: 'El archivo no es una imagen JPG o PNG ni un PDF. Elegí otro archivo.',
    })
  })

  it('un archivo del almacenamiento que declara JPEG con contenido PNG se rechaza como contradictorio', async () => {
    mockArchivo.cabecera = PNG
    documento.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///c/x.jpg', name: 'x.jpg', mimeType: 'image/jpeg', size: 100 }],
    })
    expect(await crearSelectorArchivos().elegirArchivo()).toEqual({
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

describe('reducción de imágenes (fotos de iPhone de más de 5 MB)', () => {
  it('una foto HEIC de 7 MiB se convierte a un JPEG reducido que cabe en el límite', async () => {
    camara.mockResolvedValue({ granted: true, canAskAgain: true })
    mockArchivo = { exists: true, size: 7 * MiB, cabecera: HEIC }
    lanzarCamara.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: 'file:///c/IMG_0001.HEIC', fileName: 'IMG_0001.HEIC', mimeType: 'image/heic', fileSize: 7 * MiB, width: 4032, height: 3024 },
      ],
    })
    const r = await crearSelectorArchivos().tomarFoto()
    expect(r).toEqual({
      tipo: 'elegido',
      archivo: { uri: 'file:///c/reducida.jpg', nombre: 'IMG_0001.jpg', tipo: 'image/jpeg', tamanoBytes: 900_000 },
    })
    expect(reducir.redimensionar).toHaveBeenCalledWith({ width: 2400 })
    expect(reducir.guardar).toHaveBeenCalledWith({ compress: 0.8, format: 'jpeg' })
  })

  it('una foto vertical se acota por el alto, y una chica no se agranda', async () => {
    camara.mockResolvedValue({ granted: true, canAskAgain: true })
    lanzarCamara.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///c/v.jpg', fileName: 'v.jpg', mimeType: 'image/jpeg', fileSize: 6 * MiB, width: 3024, height: 4032 }],
    })
    await crearSelectorArchivos().tomarFoto()
    expect(reducir.redimensionar).toHaveBeenCalledWith({ height: 2400 })

    reducir.redimensionar.mockClear()
    lanzarCamara.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///c/c.jpg', fileName: 'c.jpg', mimeType: 'image/jpeg', fileSize: 300_000, width: 1600, height: 1200 }],
    })
    await crearSelectorArchivos().tomarFoto()
    expect(reducir.redimensionar).not.toHaveBeenCalled()
  })

  it('si el selector no informa las dimensiones, se miden antes de decidir la reducción', async () => {
    lanzarGaleria.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///c/g.jpg', fileName: 'g.jpg', mimeType: 'image/jpeg', fileSize: 6 * MiB }],
    })
    await crearSelectorArchivos().elegirImagen()
    expect(manipular).toHaveBeenCalledTimes(2)
    expect(reducir.redimensionar).toHaveBeenCalledWith({ width: 2400 })
  })

  it('si tras reducir sigue sobre el límite, se rechaza con el mensaje de tamaño', async () => {
    reducir.tamanoFinal = 6 * MiB
    lanzarGaleria.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///c/g.jpg', fileName: 'g.jpg', mimeType: 'image/jpeg', fileSize: 9 * MiB, width: 4000, height: 3000 }],
    })
    expect(await crearSelectorArchivos().elegirImagen()).toEqual({
      tipo: 'invalido',
      mensaje: 'El archivo supera el máximo de 5 MB.',
    })
  })

  it('un PNG del almacenamiento que ya entra en el límite no se toca; uno que no entra se reduce', async () => {
    mockArchivo = { exists: true, size: 1 * MiB, cabecera: PNG }
    documento.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///c/p.png', name: 'p.png', mimeType: 'image/png', size: 1 * MiB }],
    })
    expect(await crearSelectorArchivos().elegirArchivo()).toEqual({
      tipo: 'elegido',
      archivo: { uri: 'file:///c/p.png', nombre: 'p.png', tipo: 'image/png', tamanoBytes: 1 * MiB },
    })
    expect(manipular).not.toHaveBeenCalled()

    mockArchivo = { exists: true, size: 6 * MiB, cabecera: PNG }
    documento.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///c/g.png', name: 'g.png', mimeType: 'image/png', size: 6 * MiB }],
    })
    expect(await crearSelectorArchivos().elegirArchivo()).toEqual({
      tipo: 'elegido',
      archivo: { uri: 'file:///c/reducida.jpg', nombre: 'g.jpg', tipo: 'image/jpeg', tamanoBytes: 900_000 },
    })
  })

  it('un PDF nunca se recodifica, aunque sea grande: solo se rechaza por tamaño', async () => {
    mockArchivo = { exists: true, size: 6 * MiB, cabecera: PDF }
    documento.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///c/g.pdf', name: 'g.pdf', mimeType: 'application/pdf', size: 6 * MiB }],
    })
    expect(await crearSelectorArchivos().elegirArchivo()).toEqual({
      tipo: 'invalido',
      mensaje: 'El archivo supera el máximo de 5 MB.',
    })
    expect(manipular).not.toHaveBeenCalled()
  })

  it('un fallo al reducir un archivo del almacenamiento es un error, no un archivo válido', async () => {
    mockArchivo = { exists: true, size: 6 * MiB, cabecera: PNG }
    manipular.mockImplementation(() => {
      throw new Error('sin memoria')
    })
    documento.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///c/g.png', name: 'g.png', mimeType: 'image/png', size: 6 * MiB }],
    })
    expect(await crearSelectorArchivos().elegirArchivo()).toEqual({ tipo: 'error' })
  })
})
