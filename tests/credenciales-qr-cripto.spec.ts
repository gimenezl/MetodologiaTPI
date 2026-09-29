import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { decodeQR } from '@paulmillr/qr/decode.js'
import {
  cargarClavesQr,
  ErrorClaveNoDisponible,
  ErrorConfiguracionQr,
  type ClavesQr,
} from '@/lib/credenciales-qr/claves'
import { generarSvgQr, svgDesdeMatriz, ZONA_SILENCIOSA } from '@/lib/credenciales-qr/imagen'
import { construirPayload, verificarPayload } from '@/lib/credenciales-qr/payload'
import {
  motivoDeInvalidez,
  verificarCredencial,
  type EstadoConsultado,
} from '@/lib/credenciales-qr/verificacion'

/**
 * Criptografía del QR de la credencial (EPT-64, RF20). Sin base de datos ni
 * navegador: el verificador es puro y por eso se prueba puro.
 *
 * TODAS las claves de esta suite son EFÍMERAS: se generan con `randomBytes` al
 * iniciar y no existen fuera de este proceso. Ninguna se imprime, se guarda ni
 * se versiona, y ningún payload de esta suite es válido en ningún otro entorno.
 */

const claveB64 = () => randomBytes(32).toString('base64url')

function entorno(pares: Record<string, string>, activa: string): Record<string, string> {
  return {
    QR_CREDENCIAL_KID_ACTIVA: activa,
    QR_CREDENCIAL_CLAVES: Object.entries(pares)
      .map(([kid, clave]) => `${kid}:${clave}`)
      .join(','),
  }
}

function clavesEfimeras(): { claves: ClavesQr; crudas: Record<string, string> } {
  const crudas = { k1: claveB64(), k2: claveB64() }
  return { claves: cargarClavesQr(entorno(crudas, 'k1')), crudas }
}

function alterarBit(texto: string, indiceBit: number): string {
  const bytes = Buffer.from(texto, 'base64url')
  bytes[indiceBit >> 3] ^= 1 << (indiceBit & 7)
  return bytes.toString('base64url')
}

test.describe('configuración de claves (falla cerrado)', () => {
  test('acepta una configuración válida y elige la clave activa', () => {
    const { claves } = clavesEfimeras()
    expect(claves.kidActivo).toBe('k1')
    expect([...claves.claves.keys()].sort()).toEqual(['k1', 'k2'])
  })

  test('sin variables, o con una sola, no arranca', () => {
    expect(() => cargarClavesQr({})).toThrow(ErrorConfiguracionQr)
    expect(() => cargarClavesQr({ QR_CREDENCIAL_KID_ACTIVA: 'k1' })).toThrow(ErrorConfiguracionQr)
    expect(() => cargarClavesQr({ QR_CREDENCIAL_CLAVES: `k1:${claveB64()}` })).toThrow(ErrorConfiguracionQr)
    expect(() => cargarClavesQr({ QR_CREDENCIAL_KID_ACTIVA: '  ', QR_CREDENCIAL_CLAVES: '  ' })).toThrow(
      ErrorConfiguracionQr
    )
  })

  test('rechaza claves cortas, de relleno, mal codificadas o repetidas', () => {
    const casos: Record<string, Record<string, string>> = {
      corta: entorno({ k1: randomBytes(31).toString('base64url') }, 'k1'),
      relleno: entorno({ k1: Buffer.alloc(32, 7).toString('base64url') }, 'k1'),
      ceros: entorno({ k1: Buffer.alloc(64, 0).toString('base64url') }, 'k1'),
      'base64 estándar': entorno({ k1: randomBytes(33).toString('base64') + '+/' }, 'k1'),
      'relleno con =': { QR_CREDENCIAL_KID_ACTIVA: 'k1', QR_CREDENCIAL_CLAVES: `k1:${claveB64()}=` },
      'sin dos puntos': { QR_CREDENCIAL_KID_ACTIVA: 'k1', QR_CREDENCIAL_CLAVES: claveB64() },
      'kid con mayúscula': entorno({ K1: claveB64() }, 'k1'),
      'kid con punto': { QR_CREDENCIAL_KID_ACTIVA: 'k1', QR_CREDENCIAL_CLAVES: `k.1:${claveB64()}` },
      'kid repetido': {
        QR_CREDENCIAL_KID_ACTIVA: 'k1',
        QR_CREDENCIAL_CLAVES: `k1:${claveB64()},k1:${claveB64()}`,
      },
      'activa ausente de la lista': entorno({ k1: claveB64() }, 'k9'),
      'kid activo inválido': entorno({ k1: claveB64() }, 'K1'),
    }
    for (const [nombre, env] of Object.entries(casos)) {
      expect(() => cargarClavesQr(env), nombre).toThrow(ErrorConfiguracionQr)
    }
  })

  test('el mensaje de error nunca contiene material de clave', () => {
    const secreto = claveB64()
    for (const env of [
      { QR_CREDENCIAL_KID_ACTIVA: 'k9', QR_CREDENCIAL_CLAVES: `k1:${secreto}` },
      { QR_CREDENCIAL_KID_ACTIVA: 'k1', QR_CREDENCIAL_CLAVES: `k1:${secreto}=` },
      { QR_CREDENCIAL_KID_ACTIVA: 'k1', QR_CREDENCIAL_CLAVES: `k1:${secreto.slice(0, 20)}` },
      { QR_CREDENCIAL_KID_ACTIVA: 'k1', QR_CREDENCIAL_CLAVES: `k1:${secreto},k1:${secreto}` },
    ]) {
      try {
        cargarClavesQr(env)
        throw new Error('debía fallar')
      } catch (error) {
        const texto = `${(error as Error).message} ${(error as Error).stack ?? ''}`
        expect(texto).not.toContain(secreto)
        expect(texto).not.toContain(secreto.slice(0, 20))
      }
    }
  })
})

test.describe('payload firmado', () => {
  test('firma y verifica; el payload tiene la estructura prevista y ningún dato personal', () => {
    const { claves } = clavesEfimeras()
    const id = randomUUID()
    const payload = construirPayload(id, 'k1', claves)

    const partes = payload.split('.')
    expect(partes).toHaveLength(4)
    expect(partes[0]).toBe('EPT1')
    expect(partes[1]).toBe('k1')
    expect(Buffer.from(partes[2], 'base64url')).toHaveLength(16)
    expect(Buffer.from(partes[3], 'base64url')).toHaveLength(32)
    expect(payload.length).toBeLessThanOrEqual(128)
    // El identificador viaja como bytes: no aparece en texto claro.
    expect(payload).not.toContain(id)
    expect(payload).not.toContain(id.replaceAll('-', ''))
    // No es una URL ni tiene esquema.
    expect(() => new URL(payload)).toThrow()
    expect(payload).not.toMatch(/[:/?#&=\s]/)

    expect(verificarPayload(payload, claves)).toEqual({ ok: true, id, kid: 'k1' })
  })

  test('el payload decodificado no contiene nombre, DNI, legajo, curso ni rol', () => {
    const { claves } = clavesEfimeras()
    const payload = construirPayload(randomUUID(), 'k1', claves)
    const bruto = payload
      .split('.')
      .map((parte, i) => (i < 2 ? parte : Buffer.from(parte, 'base64url').toString('latin1')))
      .join('|')
    for (const prohibido of [/dni/i, /legajo/i, /curso/i, /nombre/i, /apellido/i, /alumno/i, /rol/i, /\d{7,8}/]) {
      expect(bruto, String(prohibido)).not.toMatch(prohibido)
    }
    // Solo cuatro campos: versión, kid, id, firma.
    expect(payload.split('.')).toHaveLength(4)
  })

  test('la firma es determinista por (id, kid, clave) y cambia con cualquiera', () => {
    const { claves } = clavesEfimeras()
    const id = randomUUID()
    const a = construirPayload(id, 'k1', claves)
    expect(construirPayload(id, 'k1', claves)).toBe(a)
    expect(construirPayload(randomUUID(), 'k1', claves)).not.toBe(a)
    expect(construirPayload(id, 'k2', claves).split('.')[3]).not.toBe(a.split('.')[3])
  })

  test('una clave equivocada no valida (mismo kid, otra clave)', () => {
    const uno = clavesEfimeras().claves
    const otro = clavesEfimeras().claves
    const payload = construirPayload(randomUUID(), 'k1', uno)
    expect(verificarPayload(payload, otro)).toEqual({ ok: false, motivo: 'FIRMA' })
  })

  test('un solo bit alterado en el identificador invalida la firma (128 de 128)', () => {
    const { claves } = clavesEfimeras()
    const [version, kid, id, firma] = construirPayload(randomUUID(), 'k1', claves).split('.')
    for (let bit = 0; bit < 128; bit += 1) {
      const alterado = [version, kid, alterarBit(id, bit), firma].join('.')
      expect(verificarPayload(alterado, claves), `bit ${bit} del id`).toEqual({ ok: false, motivo: 'FIRMA' })
    }
  })

  test('un solo bit alterado en la firma invalida el payload (256 de 256)', () => {
    const { claves } = clavesEfimeras()
    const [version, kid, id, firma] = construirPayload(randomUUID(), 'k1', claves).split('.')
    for (let bit = 0; bit < 256; bit += 1) {
      const alterado = [version, kid, id, alterarBit(firma, bit)].join('.')
      expect(verificarPayload(alterado, claves), `bit ${bit} de la firma`).toEqual({
        ok: false,
        motivo: 'FIRMA',
      })
    }
  })

  test('alterar el kid invalida la firma (kid conocido) o se rechaza (kid desconocido)', () => {
    const { claves } = clavesEfimeras()
    const [version, , id, firma] = construirPayload(randomUUID(), 'k1', claves).split('.')
    expect(verificarPayload([version, 'k2', id, firma].join('.'), claves)).toEqual({ ok: false, motivo: 'FIRMA' })
    expect(verificarPayload([version, 'k3', id, firma].join('.'), claves)).toEqual({
      ok: false,
      motivo: 'KID_DESCONOCIDO',
    })
    // Un solo bit del texto del kid ('k1' → 'k0' y 'k1' → 'c1').
    expect(verificarPayload([version, 'k0', id, firma].join('.'), claves).ok).toBe(false)
    expect(verificarPayload([version, 'c1', id, firma].join('.'), claves).ok).toBe(false)
  })

  test('versión desconocida y formato malformado se rechazan', () => {
    const { claves } = clavesEfimeras()
    const [, kid, id, firma] = construirPayload(randomUUID(), 'k1', claves).split('.')
    const valido = ['EPT1', kid, id, firma].join('.')

    expect(verificarPayload(['EPT2', kid, id, firma].join('.'), claves)).toEqual({ ok: false, motivo: 'VERSION' })
    expect(verificarPayload(['EPT0', kid, id, firma].join('.'), claves)).toEqual({ ok: false, motivo: 'VERSION' })
    expect(verificarPayload(['XYZ1', kid, id, firma].join('.'), claves)).toEqual({ ok: false, motivo: 'FORMATO' })
    expect(verificarPayload(['ept1', kid, id, firma].join('.'), claves).ok).toBe(false)

    const malformados: unknown[] = [
      undefined,
      null,
      42,
      {},
      [],
      '',
      ' ',
      'EPT1',
      'EPT1.k1',
      'EPT1.k1.x',
      'EPT1.k1.x.y',
      valido + '.extra',
      valido.replace('.', '..'),
      valido + ' ',
      ' ' + valido,
      valido + '\n',
      valido.slice(0, -1),
      valido + 'A',
      valido.replace(id, id.slice(0, -1)),
      valido.replace(id, id + 'A'),
      valido.replace(firma, firma.slice(0, -1)),
      valido.replace(firma, firma + '='),
      valido.replace(id, id.slice(0, 21) + '='),
      valido.replace(kid, 'K1'),
      valido.replace(kid, ''),
      valido.replace(kid, 'k'.repeat(17)),
      valido.replace(kid, 'ñ1'),
      valido.replace(id, id.slice(0, 20) + '+/'),
      valido.replace('EPT1', 'EPT1\u0000'),
      'https://ejemplo.invalid/' + valido,
      'a'.repeat(129),
      'a'.repeat(100000),
      valido.replaceAll('.', ','),
    ]
    for (const entrada of malformados) {
      expect(verificarPayload(entrada, claves).ok, JSON.stringify(entrada)?.slice(0, 60)).toBe(false)
    }
  })

  test('rechaza codificaciones no canónicas aunque decodifiquen a los mismos bytes', () => {
    const { claves } = clavesEfimeras()
    const [version, kid, id, firma] = construirPayload(randomUUID(), 'k1', claves).split('.')
    // Los últimos caracteres de un base64url de 16 y de 32 bytes solo pueden
    // tomar 16 y 4 valores; los demás decodifican a los mismos bytes con bits
    // sobrantes distintos de cero.
    const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    const ultimo = id.at(-1)!
    const variantes = [...alfabeto].filter((c) => c !== ultimo && Buffer.from(id.slice(0, -1) + c, 'base64url').equals(Buffer.from(id, 'base64url')))
    expect(variantes.length).toBeGreaterThan(0)
    for (const c of variantes) {
      const alterado = [version, kid, id.slice(0, -1) + c, firma].join('.')
      expect(verificarPayload(alterado, claves), `variante ${c}`).toEqual({ ok: false, motivo: 'FORMATO' })
    }
    const ultimaFirma = firma.at(-1)!
    const variantesFirma = [...alfabeto].filter((c) => c !== ultimaFirma && Buffer.from(firma.slice(0, -1) + c, 'base64url').equals(Buffer.from(firma, 'base64url')))
    expect(variantesFirma.length).toBeGreaterThan(0)
    for (const c of variantesFirma) {
      const alterado = [version, kid, id, firma.slice(0, -1) + c].join('.')
      expect(verificarPayload(alterado, claves).ok, `variante de firma ${c}`).toBe(false)
    }
  })

  test('sin la clave del kid no se puede construir un payload', () => {
    const { claves } = clavesEfimeras()
    expect(() => construirPayload(randomUUID(), 'k9', claves)).toThrow(ErrorClaveNoDisponible)
    expect(() => construirPayload('no-es-un-uuid', 'k1', claves)).toThrow(TypeError)
    expect(() => construirPayload(randomUUID(), 'K1', claves)).toThrow(TypeError)
  })

  test('rotación: las credenciales viejas siguen valiendo con la clave vieja y las nuevas usan la activa', () => {
    const crudas = { k1: claveB64(), k2: claveB64() }
    const antes = cargarClavesQr(entorno({ k1: crudas.k1 }, 'k1'))
    const viejo = construirPayload(randomUUID(), 'k1', antes)

    const despues = cargarClavesQr(entorno(crudas, 'k2'))
    expect(despues.kidActivo).toBe('k2')
    expect(verificarPayload(viejo, despues).ok).toBe(true)
    expect(verificarPayload(construirPayload(randomUUID(), despues.kidActivo, despues), despues).ok).toBe(true)

    // Retirar la clave vieja invalida sus credenciales (por eso se retira solo sin ACTIVAS con ese kid).
    const retirada = cargarClavesQr(entorno({ k2: crudas.k2 }, 'k2'))
    expect(verificarPayload(viejo, retirada)).toEqual({ ok: false, motivo: 'KID_DESCONOCIDO' })
  })
})

test.describe('la firma se comprueba ANTES de consultar la base', () => {
  const estadoVigente: EstadoConsultado = {
    estadoCredencial: 'ACTIVA',
    estadoAlumno: 'ACTIVO',
    accesoAlumno: 'HABILITADO',
  }

  function espia(respuesta: EstadoConsultado | null) {
    const llamadas: string[] = []
    return {
      llamadas,
      consultar: async (id: string) => {
        llamadas.push(id)
        return respuesta
      },
    }
  }

  test('una firma válida consulta exactamente una vez, con el id extraído', async () => {
    const { claves } = clavesEfimeras()
    const id = randomUUID()
    const { llamadas, consultar } = espia(estadoVigente)
    const resultado = await verificarCredencial(construirPayload(id, 'k1', claves), claves, consultar)
    expect(llamadas).toEqual([id])
    expect(resultado).toEqual({ reconocido: true, valida: true })
  })

  test('ningún payload inválido llega a la base: 0 consultas', async () => {
    const { claves } = clavesEfimeras()
    const otras = clavesEfimeras().claves
    const [version, kid, id, firma] = construirPayload(randomUUID(), 'k1', claves).split('.')
    const invalidos: unknown[] = [
      undefined,
      '',
      'basura',
      [version, kid, id, alterarBit(firma, 3)].join('.'),
      [version, kid, alterarBit(id, 5), firma].join('.'),
      [version, 'k2', id, firma].join('.'),
      [version, 'k9', id, firma].join('.'),
      ['EPT9', kid, id, firma].join('.'),
      construirPayload(randomUUID(), 'k1', otras), // firmado con otra clave
    ]
    const { llamadas, consultar } = espia(estadoVigente)
    for (const entrada of invalidos) {
      expect(await verificarCredencial(entrada, claves, consultar)).toEqual({ reconocido: false })
    }
    expect(llamadas).toHaveLength(0)
  })

  test('sin oráculo: todo lo inválido y un id firmado pero desconocido responden igual', async () => {
    const { claves } = clavesEfimeras()
    const [version, kid, id, firma] = construirPayload(randomUUID(), 'k1', claves).split('.')
    const espiaDesconocido = espia(null)

    const firmaAlterada = await verificarCredencial([version, kid, id, alterarBit(firma, 9)].join('.'), claves, espiaDesconocido.consultar)
    const malformado = await verificarCredencial('EPT1.no.es.valido', claves, espiaDesconocido.consultar)
    const kidDesconocido = await verificarCredencial([version, 'k9', id, firma].join('.'), claves, espiaDesconocido.consultar)
    const firmadoPeroInexistente = await verificarCredencial(
      construirPayload(randomUUID(), 'k1', claves),
      claves,
      espiaDesconocido.consultar
    )

    expect(firmaAlterada).toEqual({ reconocido: false })
    expect(malformado).toEqual(firmaAlterada)
    expect(kidDesconocido).toEqual(firmaAlterada)
    expect(firmadoPeroInexistente).toEqual(firmaAlterada)
    // Solo la última llegó a la base.
    expect(espiaDesconocido.llamadas).toHaveLength(1)
  })

  test('un error de la base se propaga: no se convierte en «válida»', async () => {
    const { claves } = clavesEfimeras()
    const payload = construirPayload(randomUUID(), 'k1', claves)
    await expect(
      verificarCredencial(payload, claves, async () => {
        throw new Error('base no disponible')
      })
    ).rejects.toThrow('base no disponible')
  })

  test('validez efectiva: credencial ACTIVA + alumno ACTIVO + perfil habilitado', () => {
    expect(motivoDeInvalidez(estadoVigente)).toBeNull()
    expect(motivoDeInvalidez({ ...estadoVigente, estadoCredencial: 'REVOCADA' })).toBe('CREDENCIAL_REVOCADA')
    expect(motivoDeInvalidez({ ...estadoVigente, estadoAlumno: 'INACTIVO' })).toBe('ALUMNO_INACTIVO')
    expect(motivoDeInvalidez({ ...estadoVigente, accesoAlumno: 'BLOQUEADO' })).toBe('ACCESO_BLOQUEADO')
    // La revocación prevalece sobre cualquier otra causa: una revocada nunca vale.
    expect(
      motivoDeInvalidez({ estadoCredencial: 'REVOCADA', estadoAlumno: 'ACTIVO', accesoAlumno: 'HABILITADO' })
    ).toBe('CREDENCIAL_REVOCADA')
  })

  test('reactivar restaura la validez solo de una credencial que sigue ACTIVA', async () => {
    const { claves } = clavesEfimeras()
    const payload = construirPayload(randomUUID(), 'k1', claves)
    const inactivo = await verificarCredencial(payload, claves, async () => ({
      ...estadoVigente,
      estadoAlumno: 'INACTIVO',
    }))
    const reactivado = await verificarCredencial(payload, claves, async () => estadoVigente)
    const revocadaYReactivada = await verificarCredencial(payload, claves, async () => ({
      ...estadoVigente,
      estadoCredencial: 'REVOCADA',
    }))
    expect(inactivo).toEqual({ reconocido: true, valida: false, motivo: 'ALUMNO_INACTIVO' })
    expect(reactivado).toEqual({ reconocido: true, valida: true })
    expect(revocadaYReactivada).toEqual({ reconocido: true, valida: false, motivo: 'CREDENCIAL_REVOCADA' })
  })
})

test.describe('imagen del QR', () => {
  test('el SVG es autocontenido, con fondo blanco, zona silenciosa y sin texto del payload', () => {
    const { claves } = clavesEfimeras()
    const payload = construirPayload(randomUUID(), 'k1', claves)
    const svg = generarSvgQr(payload)

    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toContain('fill="#ffffff"')
    expect(svg).toContain('fill="#000000"')
    expect(svg).not.toContain('<text')
    expect(svg).not.toContain('<title')
    expect(svg).not.toContain(payload)
    expect(svg).not.toContain(payload.split('.')[2])
    expect(svg).not.toContain(payload.split('.')[3])
    expect(svg.length).toBeLessThan(12_000)
  })

  test('el SVG generado se decodifica de vuelta al mismo texto (legibilidad real)', () => {
    const { claves } = clavesEfimeras()
    const payload = construirPayload(randomUUID(), 'k1', claves)
    const svg = generarSvgQr(payload)

    const lado = Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)![1])
    const escala = 8
    const pixeles = new Uint8ClampedArray(lado * escala * lado * escala * 4).fill(255)
    for (const m of svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      const [x0, y0, largo] = [Number(m[1]), Number(m[2]), Number(m[3])]
      for (let y = y0 * escala; y < (y0 + 1) * escala; y += 1) {
        for (let x = x0 * escala; x < (x0 + largo) * escala; x += 1) {
          const i = (y * lado * escala + x) * 4
          pixeles[i] = pixeles[i + 1] = pixeles[i + 2] = 0
        }
      }
    }

    const decodificado = decodeQR({ width: lado * escala, height: lado * escala, data: pixeles })
    expect(decodificado).toBe(payload)
  })

  test('respeta la zona silenciosa de 4 módulos en los cuatro bordes', () => {
    const matriz = Array.from({ length: 21 }, () => Array.from({ length: 21 }, () => true))
    const svg = svgDesdeMatriz(matriz)
    const lado = 21 + ZONA_SILENCIOSA * 2
    expect(svg).toContain(`viewBox="0 0 ${lado} ${lado}"`)
    // Todos los segmentos oscuros empiezan a 4 módulos del borde y terminan a 4 del borde opuesto.
    const segmentos = [...svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
      largo: Number(m[3]),
    }))
    expect(segmentos.length).toBe(21)
    for (const s of segmentos) {
      expect(s.x).toBe(ZONA_SILENCIOSA)
      expect(s.x + s.largo).toBe(lado - ZONA_SILENCIOSA)
      expect(s.y).toBeGreaterThanOrEqual(ZONA_SILENCIOSA)
      expect(s.y).toBeLessThan(lado - ZONA_SILENCIOSA)
    }
  })
})
