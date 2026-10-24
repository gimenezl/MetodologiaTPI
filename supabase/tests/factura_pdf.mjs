import assert from 'node:assert/strict'
import { register } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { PDFDocument } from 'pdf-lib'
import { extractText, getDocumentProxy } from 'unpdf'

/**
 * EPT-115 / EPT-160-161 — factura PDF, plantilla y clasificación SMTP, sin red.
 * Carga los módulos TypeScript con la eliminación de tipos de Node y un resolvedor
 * mínimo para el alias `@/`.
 */
const raiz = pathToFileURL(path.resolve('.') + path.sep).href
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(especificador, contexto, siguiente) {
  if (especificador.startsWith('@/')) especificador = ${JSON.stringify(raiz)} + 'src/' + especificador.slice(2) + '.ts'
  return siguiente(especificador, contexto)
}`))
const { generarFacturaPdf } = await import('../../src/services/factura-pdf.ts')
const { armarRecordatorio, nombreAdjunto, verificarConjunto } = await import('../../src/services/recordatorio-correo.ts')
const { clasificarErrorSmtp } = await import('../../src/services/correo.server.ts')

let n = 0
const ok = (t) => { n++; console.log(`OK ${n}: ${t}`) }
const uuid = (i) => `a0000000-0000-4000-8000-${String(i).padStart(12, '0')}`
const ESTADOS = ['PENDIENTE', 'EN_VERIFICACION', 'PAGADO']
const items = (cuantos, largo = false) => Array.from({ length: cuantos }, (_, i) => ({
  item_id: uuid(i + 1),
  concepto: ['CUOTA', 'DEPORTE', 'TRANSPORTE', 'COMEDOR'][i % 4],
  detalle: largo ? `Actividad ${'extraordinariamente_larga_sin_espacios_'.repeat(6)}${i}` : `Ítem ${i} áéíóú ñ`,
  importe: '10.05',
  estado_pago: ESTADOS[i % 3],
}))
const formato = (c) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`
function factura(cuantos, alumno = 'Pérez, Ana', largo = false, id = 1) {
  const its = items(cuantos, largo)
  const cent = (e) => its.filter((x) => !e || x.estado_pago === e).length * 1005
  return {
    factura_id: uuid(900 + id), alumno, periodo: '2026-11-01', vencimiento: '2026-11-10', generada_en: '2026-10-29T15:00:00.000Z',
    total: formato(cent()), pagado: formato(cent('PAGADO')), en_verificacion: formato(cent('EN_VERIFICACION')),
    pendiente: formato(cent('PENDIENTE')), items: its,
  }
}

const salida = path.resolve(process.env.EPT_PDF_MUESTRAS ?? '.tmp-pdf-ept115')
mkdirSync(salida, { recursive: true })

// 1. Factura corta
const corta = await generarFacturaPdf(factura(4))
assert.equal(Buffer.from(corta.slice(0, 5)).toString(), '%PDF-')
const t = (await extractText(corta.slice(), { mergePages: true })).text
for (const x of ['Factura institucional', 'noviembre de 2026', '10/11/2026', 'Pérez, Ana', 'Ítem 1 áéíóú ñ', 'Total facturado', 'Saldo por abonar', 'No es un comprobante fiscal']) {
  assert.ok(t.includes(x), `contiene ${x}`)
}
assert.ok(!t.includes('Recibo'))
writeFileSync(path.join(salida, 'factura-corta.pdf'), corta)
ok('factura corta: texto, acentos, período, vencimiento y leyenda de no fiscal')

// 2. Varias páginas y textos sin espacios (no recortan)
const larga = await generarFacturaPdf(factura(80, 'María de los Ángeles Concepción del Rosario Fernández de la Peña y Rodríguez Montenegro', true, 2))
const doc = await PDFDocument.load(larga.slice())
assert.ok(doc.getPageCount() >= 3)
const tl = (await extractText(larga.slice(), { mergePages: true })).text
assert.ok(tl.includes(`Página ${doc.getPageCount()} de ${doc.getPageCount()}`))
assert.ok(tl.replace(/\s+/gu, '').includes('extraordinariamente_larga_sin_espacios_'.repeat(6)))
writeFileSync(path.join(salida, 'factura-multipagina.pdf'), larga)
ok(`factura de ${doc.getPageCount()} páginas con ítems de texto largo sin espacios: numeración y contenido íntegro`)

// 2b. Geometría: ningún texto fuera de los márgenes de A4 (595,28 x 841,89 pt)
for (const [nombre, bytes] of [['corta', corta], ['multipágina', larga]]) {
  const pdfjs = await getDocumentProxy(bytes.slice())
  for (let i = 1; i <= pdfjs.numPages; i++) {
    const contenido = await (await pdfjs.getPage(i)).getTextContent()
    for (const it of contenido.items) {
      if (!it.str?.trim()) continue
      const [, , , , x, y] = it.transform
      assert.ok(x >= 40 && x + it.width <= 556, `${nombre} p${i}: «${it.str.slice(0, 30)}» fuera de márgenes (x=${x.toFixed(1)}, ancho=${it.width.toFixed(1)})`)
      assert.ok(y >= 25 && y <= 805, `${nombre} p${i}: texto fuera de la página (y=${y.toFixed(1)})`)
    }
  }
}
ok('geometría: todo el texto de ambas facturas queda dentro de los márgenes y de la página')

// 3. Sin contenido activo ni recursos externos
const crudo = Buffer.from(larga).toString('latin1') + Buffer.from(corta).toString('latin1')
for (const peligroso of ['/JavaScript', '/JS ', '/URI', '/Launch', '/OpenAction', '/EmbeddedFile', '/AA ', '/SubmitForm', '/ImportData']) {
  assert.ok(!crudo.includes(peligroso), `sin ${peligroso}`)
}
ok('PDF sin JavaScript, URI, acciones automáticas, adjuntos incrustados ni recursos externos')

// 4. Validación de entradas
await assert.rejects(generarFacturaPdf({ ...factura(3), total: '1.00' }), /incoherentes/u)
await assert.rejects(generarFacturaPdf({ ...factura(3), pendiente: '0.01' }), /incoherentes/u)
await assert.rejects(generarFacturaPdf({ ...factura(3), total: '1e3' }))
await assert.rejects(generarFacturaPdf({ ...factura(3), factura_id: 'x' }))
await assert.rejects(generarFacturaPdf({ ...factura(3), items: [{ ...items(1)[0], concepto: 'PAGO' }] }))
ok('totales incoherentes, importes con notación científica y datos inválidos se rechazan')

// 5. Plantilla: conjunto, escape y suma exacta sin flotantes
const hijos = [factura(5, 'Pérez, Ana', false, 1), factura(5, '<script>alert(1)</script> & Co', false, 2)]
const suma = (c) => hijos.reduce((s, h) => s + Math.round(Number(h[c]) * 100), 0)
const datos = {
  user_id: uuid(5), padre: 'Padre, Uno', periodo: '2026-11-01', fecha_programada: '2026-10-30', hijos,
  total_facturado: formato(suma('total')), pagado: formato(suma('pagado')),
  en_verificacion: formato(suma('en_verificacion')), saldo_por_abonar: formato(suma('pendiente')),
}
const correo = armarRecordatorio(datos)
assert.ok(correo.html.includes('&lt;script&gt;') && !correo.html.includes('<script>'))
assert.ok(correo.texto.includes('Pérez, Ana') && correo.texto.includes('Cuota') && correo.texto.includes('Comedor'))
assert.match(correo.asunto, /noviembre de 2026/u)
assert.throws(() => verificarConjunto({ ...datos, total_facturado: '0.01' }), /no coinciden/u)
assert.throws(() => verificarConjunto({ ...datos, hijos: [hijos[0], hijos[0]] }), /(repetidas|no coinciden)/u)
assert.throws(() => verificarConjunto({ ...datos, hijos: [hijos[0], { ...hijos[1], periodo: '2026-12-01' }] }), /(otro período|no coinciden)/u)
assert.throws(() => verificarConjunto({ ...datos, hijos: [hijos[0], { ...hijos[1], vencimiento: '2026-11-11' }] }), /vencimientos distintos/u)
await assert.rejects(generarFacturaPdf({ ...factura(3), periodo: '2026-13-01' }))
// Aritmética exacta: 0,10 + 0,20 no produce 0,30000000000000004
const exacto = armarRecordatorio({
  ...datos,
  hijos: [{ ...hijos[0], items: [{ ...hijos[0].items[0], importe: '0.10', estado_pago: 'PENDIENTE' }, { ...hijos[0].items[1], importe: '0.20', estado_pago: 'PENDIENTE' }],
    total: '0.30', pagado: '0.00', en_verificacion: '0.00', pendiente: '0.30' }],
  total_facturado: '0.30', pagado: '0.00', en_verificacion: '0.00', saldo_por_abonar: '0.30',
})
assert.ok(exacto.texto.includes('Saldo por abonar: ARS 0,30'))
assert.equal(nombreAdjunto('María Ángeles / ../etc', '2026-11-01', 0), 'factura-2026-11-1-Maria-Angeles-etc.pdf')
writeFileSync(path.join(salida, 'correo-muestra.html'), correo.html)
ok('plantilla: HTML escapado, conjunto coherente (total, duplicados, período), aritmética exacta y nombre de adjunto saneado')

// 6. Clasificación SMTP con la fase observada
const err = (props) => Object.assign(new Error('x'), props)
assert.equal(clasificarErrorSmtp(err({ code: 'ECONNECTION', command: 'CONN' }), false).estado, 'FALLO_CLARO')
assert.equal(clasificarErrorSmtp(err({ code: 'EENVELOPE', command: 'RCPT TO', responseCode: 550 }), false).estado, 'FALLO_CLARO')
assert.equal(clasificarErrorSmtp(err({ code: 'EAUTH', command: 'AUTH PLAIN', responseCode: 535 }), false).estado, 'FALLO_CLARO')
assert.equal(clasificarErrorSmtp(err({ code: 'EMESSAGE', command: 'DATA', responseCode: 554 }), true).estado, 'FALLO_CLARO')
assert.equal(clasificarErrorSmtp(err({ code: 'EMESSAGE', command: 'DATA', responseCode: 451 }), true).estado, 'FALLO_CLARO')
// Nodemailer rotula CONN cortes y plazos vencidos aun en medio de DATA: con DATA iniciado es INCIERTO.
assert.equal(clasificarErrorSmtp(err({ code: 'ECONNECTION', command: 'CONN' }), true).estado, 'INCIERTO')
assert.equal(clasificarErrorSmtp(err({ code: 'ETIMEDOUT', command: 'CONN' }), true).estado, 'INCIERTO')
assert.equal(clasificarErrorSmtp(err({ code: 'ESOCKET', command: 'CONN' }), true).estado, 'INCIERTO')
assert.equal(clasificarErrorSmtp(new Error('desconocido'), true).estado, 'INCIERTO')
assert.equal(clasificarErrorSmtp('texto', true).estado, 'INCIERTO')
const causa = clasificarErrorSmtp(err({ code: 'EENVELOPE', command: 'RCPT TO', responseCode: 550, message: 'user@dominio.com rechazado' }), false).causa
assert.ok(!causa.includes('@') && causa.length < 100)
ok('clasificador SMTP: fallo claro solo antes de DATA o con rechazo explícito; cortes y plazos desde DATA son INCIERTO; la causa no incluye destinatarios')
console.log(`PASS ${n} escenarios de PDF, plantilla y clasificación.`)
