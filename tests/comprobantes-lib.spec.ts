import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import {
  TAMANO_MAXIMO_BYTES,
  centavosDeImporte,
  normalizarImporteTransferencia,
  tipoDesdeNombre,
  validarArchivoDeclarado,
  validarFechaTransferencia,
  validarNumeroOperacion,
} from '@/lib/comprobantes-contrato'
import { extraerToken } from '@/services/autenticacion-bearer'
import { decisionPagoSchema, verificacionPagoSchema, errorVerificacion } from '@/lib/comprobantes-verificacion'
import {
  detectarTipo,
  estructuraPngValida,
  validarComprobante,
} from '@/services/comprobantes-validacion'

test.describe('EPT-111: contrato estricto de decisión y recuperación', () => {
  test('solo permite dos decisiones y exige motivo sin aceptar campos de autoridad', () => {
    expect(decisionPagoSchema.safeParse({ decision: 'APROBADO' }).success).toBe(true)
    expect(decisionPagoSchema.parse({ decision: 'RECHAZADO', motivo: '  No corresponde  ' })).toEqual({ decision: 'RECHAZADO', motivo: 'No corresponde' })
    for (const entrada of [null, {}, { decision: 'OTRA' }, { decision: 'RECHAZADO' },
      { decision: 'RECHAZADO', motivo: ' \n\t' }, { decision: 'APROBADO', motivo: 'x' },
      { decision: 'APROBADO', actor: 'inventado' }, { decision: 'APROBADO', importe: '1.00' }]) {
      expect(decisionPagoSchema.safeParse(entrada).success).toBe(false)
    }
  })
  test('una respuesta no fiable o incoherente nunca se interpreta como éxito', () => {
    const pendiente = { pago_id: 'b1110000-0000-4000-8000-000000000061', estado: 'PENDIENTE_VERIFICACION',
      verificado_por: null, verificado_en: null, motivo_rechazo: null, repetido: false }
    expect(verificacionPagoSchema.safeParse(pendiente).success).toBe(true)
    for (const respuesta of [{}, { ...pendiente, estado: 'APROBADO' },
      { ...pendiente, estado: 'RECHAZADO', motivo_rechazo: ' ' }, { ...pendiente, verificado_por: pendiente.pago_id },
      { ...pendiente, repetido: 'true' }]) {
      expect(verificacionPagoSchema.safeParse(respuesta).success).toBe(false)
    }
  })
  test('fallas desconocidas obligan a consultar, conflictos no se ocultan como éxito', () => {
    expect(errorVerificacion('desconocido').codigo).toBe('RESULTADO_INCIERTO')
    expect(errorVerificacion('P6882').estado).toBe(409)
    expect(errorVerificacion('P6883').codigo).toBe('PAGO_INCOHERENTE')
    for (const codigo of ['P6880', 'P6881', '42501', 'P5505']) {
      expect(errorVerificacion(codigo).error).not.toMatch(/P\d{4}|SQLSTATE|supabase/iu)
    }
  })
})

/**
 * EPT-109: contrato compartido y validación del contenido. Archivos sintéticos
 * generados acá (sin datos personales). Un PASS de este archivo prueba la lógica
 * de formato; no prueba Storage, SQL ni la aplicación móvil.
 */

async function jpeg(ancho = 40, alto = 30): Promise<Buffer> {
  return sharp({ create: { width: ancho, height: alto, channels: 3, background: '#2060a0' } })
    .jpeg()
    .toBuffer()
}
async function png(ancho = 40, alto = 30): Promise<Buffer> {
  return sharp({ create: { width: ancho, height: alto, channels: 3, background: '#a06020' } })
    .png()
    .toBuffer()
}

/** PDF mínimo con tabla xref real (offsets calculados). */
function pdf(extraCatalogo = '', cuerpoExtra = ''): Buffer {
  const objetos = [
    `<< /Type /Catalog /Pages 2 0 R${extraCatalogo} >>`,
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
  ]
  let salida = '%PDF-1.4\n'
  const offsets: number[] = []
  objetos.forEach((o, i) => {
    offsets.push(salida.length)
    salida += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  salida += cuerpoExtra
  const xref = salida.length
  salida += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) salida += `${String(o).padStart(10, '0')} 00000 n \n`
  salida += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(salida, 'latin1')
}

/** PDF válido con un objeto de flujo Flate extra (offsets calculados). `contenido` es lo que va comprimido. */
function pdfConFlujo(contenido: Buffer): Buffer {
  const comprimido = deflateSync(contenido)
  const cabeceras = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
  ]
  const partes: Buffer[] = []
  const offsets: number[] = []
  let largo = 0
  const agregar = (b: Buffer | string) => {
    const buf = typeof b === 'string' ? Buffer.from(b, 'latin1') : b
    partes.push(buf)
    largo += buf.length
  }
  agregar('%PDF-1.5\n')
  cabeceras.forEach((o, i) => {
    offsets.push(largo)
    agregar(`${i + 1} 0 obj\n${o}\nendobj\n`)
  })
  offsets.push(largo)
  agregar(`4 0 obj\n<< /Length ${comprimido.length} /Filter /FlateDecode >>\nstream\n`)
  agregar(comprimido)
  agregar('\nendstream\nendobj\n')
  const xref = largo
  let tabla = 'xref\n0 5\n0000000000 65535 f \n'
  for (const o of offsets) tabla += `${String(o).padStart(10, '0')} 00000 n \n`
  tabla += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  agregar(tabla)
  return Buffer.concat(partes)
}

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

test.describe('contrato compartido: archivo declarado', () => {
  test('acepta los tres tipos y el límite exacto de 5 MiB', () => {
    for (const tipo of ['image/jpeg', 'image/png', 'application/pdf']) {
      expect(validarArchivoDeclarado(tipo, 1).ok).toBe(true)
      expect(validarArchivoDeclarado(tipo, TAMANO_MAXIMO_BYTES).ok).toBe(true)
    }
    expect(TAMANO_MAXIMO_BYTES).toBe(5 * 1024 * 1024)
  })

  test('rechaza vacío, un byte de más, tipos no permitidos y tamaños no enteros', () => {
    expect(validarArchivoDeclarado('image/png', 0)).toMatchObject({ ok: false, codigo: 'ARCHIVO_VACIO' })
    expect(validarArchivoDeclarado('image/png', TAMANO_MAXIMO_BYTES + 1)).toMatchObject({
      ok: false,
      codigo: 'ARCHIVO_DEMASIADO_GRANDE',
    })
    for (const tipo of ['image/svg+xml', 'text/html', 'image/gif', 'application/zip', '', null]) {
      expect(validarArchivoDeclarado(tipo, 10)).toMatchObject({ ok: false, codigo: 'TIPO_NO_PERMITIDO' })
    }
    expect(validarArchivoDeclarado('image/png', 1.5).ok).toBe(false)
    expect(validarArchivoDeclarado('image/png', Number.NaN).ok).toBe(false)
  })

  test('la extensión solo orienta a la interfaz', () => {
    expect(tipoDesdeNombre('foto.JPG')).toBe('image/jpeg')
    expect(tipoDesdeNombre('a.jpeg')).toBe('image/jpeg')
    expect(tipoDesdeNombre('a.png')).toBe('image/png')
    expect(tipoDesdeNombre('a.pdf')).toBe('application/pdf')
    expect(tipoDesdeNombre('a.svg')).toBeNull()
    expect(tipoDesdeNombre('sin-extension')).toBeNull()
  })
})

test.describe('contrato compartido: datos de la transferencia', () => {
  test('importe: un único separador y hasta dos decimales, sin redondear', () => {
    expect(normalizarImporteTransferencia('15000')).toEqual({ ok: true, valor: '15000' })
    expect(normalizarImporteTransferencia('15000,5')).toEqual({ ok: true, valor: '15000.5' })
    expect(normalizarImporteTransferencia(' 15000.50 ')).toEqual({ ok: true, valor: '15000.50' })
    expect(normalizarImporteTransferencia('0,01')).toEqual({ ok: true, valor: '0.01' })
    expect(normalizarImporteTransferencia('0')).toEqual({ ok: true, valor: '0' })
    expect(normalizarImporteTransferencia('007')).toEqual({ ok: true, valor: '7' })
    for (const malo of ['', '1,234', '1.234', '1.500,00', '-5', '1e3', 'NaN', '12.', '.5',
      '99999999999', '1,2,3', 'abc', '١٢٣']) {
      expect(normalizarImporteTransferencia(malo).ok, `«${malo}»`).toBe(false)
    }
  })

  test('los centavos son exactos', () => {
    expect(centavosDeImporte('15000.50')).toBe(1_500_050)
    expect(centavosDeImporte('0.05')).toBe(5)
    expect(centavosDeImporte('7')).toBe(700)
    expect(centavosDeImporte('0.1')).toBe(10)
  })

  test('fecha: calendario real, sin prohibir futuras', () => {
    expect(validarFechaTransferencia('2026-10-15')).toEqual({ ok: true, valor: '2026-10-15' })
    expect(validarFechaTransferencia('2028-02-29').ok).toBe(true)
    expect(validarFechaTransferencia('2099-12-31').ok).toBe(true)
    for (const mala of ['2026-02-30', '2027-02-29', '2026-13-01', '15/10/2026', '2026-1-1',
      '', 'infinity', '0000-01-01']) {
      expect(validarFechaTransferencia(mala).ok, mala).toBe(false)
    }
  })

  test('número de operación: recorte sin tocar mayúsculas ni imponer 30 caracteres', () => {
    expect(validarNumeroOperacion('  AbC-123 \n')).toEqual({ ok: true, valor: 'AbC-123' })
    expect(validarNumeroOperacion('x'.repeat(31)).ok).toBe(true)
    expect(validarNumeroOperacion('   ').ok).toBe(false)
    expect(validarNumeroOperacion('é'.repeat(1001)).ok).toBe(false)
  })
})

test.describe('validación del contenido', () => {
  test('acepta JPEG, PNG y PDF reales y devuelve el SHA-256 de esos bytes', async () => {
    const j = await jpeg()
    const p = await png()
    const d = pdf()
    const rj = await validarComprobante(j, 'image/jpeg')
    const rp = await validarComprobante(p, 'image/png')
    const rd = await validarComprobante(d, 'application/pdf')
    expect(rj).toMatchObject({ ok: true, tipo: 'image/jpeg', tamano: j.length, sha256: sha(j) })
    expect(rp).toMatchObject({ ok: true, tipo: 'image/png', tamano: p.length, sha256: sha(p) })
    expect(rd).toMatchObject({ ok: true, tipo: 'application/pdf', tamano: d.length, sha256: sha(d) })
  })

  test('límite exacto sí, un byte más no', async () => {
    const j = await jpeg()
    const justo = Buffer.concat([j, Buffer.alloc(TAMANO_MAXIMO_BYTES - j.length)])
    expect(justo.length).toBe(TAMANO_MAXIMO_BYTES)
    expect((await validarComprobante(justo, 'image/jpeg')).ok).toBe(true)
    const pasado = Buffer.concat([justo, Buffer.alloc(1)])
    expect(await validarComprobante(pasado, 'image/jpeg')).toMatchObject({
      ok: false,
      codigo: 'ARCHIVO_DEMASIADO_GRANDE',
    })
  })

  test('cero bytes y contenido que no es ninguno de los tres', async () => {
    expect(await validarComprobante(new Uint8Array(0), 'image/png')).toMatchObject({
      ok: false,
      codigo: 'ARCHIVO_VACIO',
    })
    const casos: Array<[string, Buffer]> = [
      ['HTML', Buffer.from('<html><script>alert(1)</script></html>')],
      ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>')],
      ['GIF', Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1')],
      ['ZIP', Buffer.from('PK\x03\x04aaaaaaaa', 'latin1')],
      ['texto', Buffer.from('hola, esto es solo texto')],
    ]
    for (const [nombre, bytes] of casos) {
      expect(await validarComprobante(bytes, 'image/png'), nombre).toMatchObject({
        ok: false,
        codigo: 'TIPO_NO_PERMITIDO',
      })
    }
  })

  test('MIME declarado y contenido contradictorios', async () => {
    const p = await png()
    const j = await jpeg()
    expect(await validarComprobante(p, 'image/jpeg')).toMatchObject({
      ok: false,
      codigo: 'CONTENIDO_NO_COINCIDE',
    })
    expect(await validarComprobante(j, 'application/pdf')).toMatchObject({
      ok: false,
      codigo: 'CONTENIDO_NO_COINCIDE',
    })
    expect(await validarComprobante(pdf(), 'image/png')).toMatchObject({
      ok: false,
      codigo: 'CONTENIDO_NO_COINCIDE',
    })
  })

  test('imágenes corruptas: firma correcta, estructura rota', async () => {
    const j = await jpeg(200, 150)
    const p = await png(200, 150)
    // Truncadas.
    expect(await validarComprobante(j.subarray(0, Math.floor(j.length / 2)), 'image/jpeg')).toMatchObject({
      ok: false,
      codigo: 'ARCHIVO_CORRUPTO',
    })
    expect(await validarComprobante(p.subarray(0, p.length - 20), 'image/png')).toMatchObject({
      ok: false,
      codigo: 'ARCHIVO_CORRUPTO',
    })
    // Solo la firma.
    expect((await validarComprobante(j.subarray(0, 3), 'image/jpeg')).ok).toBe(false)
    expect((await validarComprobante(p.subarray(0, 8), 'image/png')).ok).toBe(false)
    // Un byte alterado dentro de un chunk rompe su CRC.
    const alterado = Buffer.from(p)
    alterado[40] ^= 0xff
    expect(estructuraPngValida(alterado)).toBe(false)
    expect((await validarComprobante(alterado, 'image/png')).ok).toBe(false)
    // Datos añadidos después de IEND.
    const conCola = Buffer.concat([p, Buffer.from('basura')])
    expect(estructuraPngValida(conCola)).toBe(false)
    expect((await validarComprobante(conCola, 'image/png')).ok).toBe(false)
  })

  test('PDF: truncado, sin estructura, sin tabla de referencias y con contenido activo', async () => {
    const d = pdf()
    expect(await validarComprobante(d.subarray(0, d.length - 30), 'application/pdf')).toMatchObject({
      ok: false,
      codigo: 'ARCHIVO_CORRUPTO',
    })
    expect(
      await validarComprobante(Buffer.from('%PDF-1.4\nbasura\n%%EOF\n'), 'application/pdf')
    ).toMatchObject({ ok: false, codigo: 'ARCHIVO_CORRUPTO' })
    // pdf.js lo reconstruye, pero no tiene `startxref`: no es un PDF bien formado.
    const sinXref = Buffer.from(
      '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
        '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 3 3]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
      'latin1'
    )
    expect((await validarComprobante(sinXref, 'application/pdf')).ok).toBe(false)
    // startxref apuntando a cualquier lado.
    const offsetMalo = Buffer.from(d.toString('latin1').replace(/startxref\n\d+/u, 'startxref\n5'), 'latin1')
    expect((await validarComprobante(offsetMalo, 'application/pdf')).ok).toBe(false)
    // JavaScript, también en un flujo de objeto abierto.
    const conJs = pdf(' /OpenAction << /S /JavaScript /JS (app.alert(1)) >>')
    expect(await validarComprobante(conJs, 'application/pdf')).toMatchObject({
      ok: false,
      codigo: 'CONTENIDO_ACTIVO',
    })
    const conLanzamiento = pdf(' /OpenAction << /S /Launch /F (cmd.exe) >>')
    expect(await validarComprobante(conLanzamiento, 'application/pdf')).toMatchObject({
      ok: false,
      codigo: 'CONTENIDO_ACTIVO',
    })
  })

  test('PDF: contenido activo con el nombre ofuscado o dentro de un flujo comprimido', async () => {
    // `/#4Aava#53cript` es `/JavaScript` para un lector PDF, pero no aparece en claro.
    const ofuscado = pdf(' /OpenAction << /S /#4Aava#53cript /JS (app.alert(1)) >>')
    expect(ofuscado.toString('latin1')).not.toContain('/JavaScript')
    expect(await validarComprobante(ofuscado, 'application/pdf')).toMatchObject({
      ok: false,
      codigo: 'CONTENIDO_ACTIVO',
    })
    // Un diccionario con la acción dentro de un flujo Flate (como un object stream de PDF 1.5).
    const enFlujo = pdfConFlujo(Buffer.from('<< /Type /Annot /A << /S /JavaScript /JS (x) >> >>'))
    expect(enFlujo.toString('latin1')).not.toContain('/JavaScript')
    expect(await validarComprobante(enFlujo, 'application/pdf')).toMatchObject({
      ok: false,
      codigo: 'CONTENIDO_ACTIVO',
    })
    // Y el mismo PDF sin acción activa es válido: el flujo comprimido no se rechaza por serlo.
    const limpio = pdfConFlujo(Buffer.from('BT /F1 12 Tf (comprobante) Tj ET'))
    expect((await validarComprobante(limpio, 'application/pdf')).ok).toBe(true)
  })

  test('PDF: un flujo que se expande de forma desmedida es una bomba y se rechaza', async () => {
    const bomba = pdfConFlujo(Buffer.alloc(20 * 1024 * 1024, 0))
    expect(bomba.length).toBeLessThan(TAMANO_MAXIMO_BYTES)
    expect(await validarComprobante(bomba, 'application/pdf')).toMatchObject({
      ok: false,
      codigo: 'ARCHIVO_CORRUPTO',
    })
  })

  test('detectarTipo y estructuraPngValida son consistentes con los fixtures', async () => {
    expect(detectarTipo(await jpeg())).toBe('image/jpeg')
    expect(detectarTipo(await png())).toBe('image/png')
    expect(detectarTipo(pdf())).toBe('application/pdf')
    expect(detectarTipo(Buffer.from('<?xml'))).toBeNull()
    expect(estructuraPngValida(await png())).toBe(true)
  })

  test('bomba de descompresión: dimensiones sobre el techo de píxeles', async () => {
    const enorme = await sharp({
      create: { width: 8000, height: 6000, channels: 3, background: '#000000' },
    })
      .png({ compressionLevel: 9 })
      .toBuffer()
    expect(enorme.length).toBeLessThan(TAMANO_MAXIMO_BYTES)
    // Control: es un PNG válido que libvips abre con su techo por defecto.
    expect(estructuraPngValida(enorme)).toBe(true)
    expect((await sharp(enorme).metadata()).width).toBe(8000)
    // 48 MP > 40 MP: la validación lo rechaza sin decodificarlo.
    expect((await validarComprobante(enorme, 'image/png')).ok).toBe(false)
  })
})

test.describe('token Bearer', () => {
  test('solo acepta un JWT con forma válida', () => {
    const jwt = 'aaaa.bbbb.cccc'
    expect(extraerToken(`Bearer ${jwt}`)).toBe(jwt)
    for (const malo of [null, '', 'Bearer', 'Bearer ', 'bearer aaaa.bbbb.cccc', 'Bearer a b',
      'Bearer uno', 'Bearer a.b', `Bearer ${'a'.repeat(5000)}.b.c`, 'Basic abc', 'Bearer a.b.c d']) {
      expect(extraerToken(malo), String(malo)).toBeNull()
    }
  })
})
