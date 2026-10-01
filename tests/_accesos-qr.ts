import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { encodeQR } from 'qr'
import { cargarClavesQr } from '@/lib/credenciales-qr/claves'
import { construirPayload } from '@/lib/credenciales-qr/payload'
import { sql } from './_credenciales-qr'

/**
 * Herramientas de las pruebas del registro de accesos con QR (EPT-65).
 *
 * Todo apunta al stack local descartable. La siembra y la limpieza usan
 * `docker exec psql` como propietario, igual que `auth.setup.ts`; no representan
 * ninguna operación disponible en la aplicación.
 *
 * Los QR de estas pruebas se firman con la clave EFÍMERA que genera
 * `supabase/tests/correr-autenticadas.mjs` para cada corrida (nunca se imprime ni
 * se guarda). Ningún payload de esta suite es válido en ningún otro entorno, y
 * ningún QR válido se escribe en la evidencia versionada.
 */

export const SERVICIOS = {
  comedor: 'e0000000-0000-4000-8000-000000000010',
  norte: 'e0000000-0000-4000-8000-000000000020',
  sur: 'e0000000-0000-4000-8000-000000000021',
  este: 'e0000000-0000-4000-8000-000000000022',
} as const

export const RUTA_REGISTRO = '/api/accesos-servicios/registro'
export const rutaAnulacion = (id: string) => `/api/accesos-servicios/${id}/anulacion`

/** Payload FIRMADO de una credencial, con la clave efímera de la corrida. */
export function payloadFirmado(credencialId: string): string {
  const claves = cargarClavesQr()
  return construirPayload(credencialId, claves.kidActivo, claves)
}

/** Cambia un carácter de la firma (último bloque) conservando el formato. */
export function payloadConFirmaAlterada(payload: string): string {
  const partes = payload.split('.')
  const firma = partes[3]
  partes[3] = `${firma.slice(0, -2)}${firma.endsWith('AA') ? 'BB' : 'AA'}`
  return partes.join('.')
}

/** Credencial ACTIVA del alumno (la crea si no existe) y su id. */
export function credencialActiva(alumnoId: string, actorDni = '99900001'): string {
  const existente = sql(`SELECT id FROM public.credenciales_qr WHERE alumno_id = '${alumnoId}' AND estado = 'ACTIVA';`)
  if (existente) return existente
  return sql(`
    INSERT INTO public.credenciales_qr (alumno_id, clave_kid, emitida_por)
    VALUES ('${alumnoId}', '${cargarClavesQr().kidActivo}', (SELECT id FROM public.perfiles WHERE dni = '${actorDni}'))
    RETURNING id;
  `).split('\n')[0]
}

/** Inscripción ACTIVA del alumno al servicio (la crea si no existe). */
export function inscribir(alumnoId: string, servicioId: string): void {
  sql(`
    INSERT INTO public.inscripciones_servicios (alumno_id, servicio_id)
    SELECT '${alumnoId}', '${servicioId}'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.inscripciones_servicios
      WHERE alumno_id = '${alumnoId}' AND servicio_id = '${servicioId}' AND estado = 'ACTIVA');
  `)
}

/** Cancela las inscripciones activas del alumno a un servicio (baja lógica, como la app). */
export function cancelarInscripcion(alumnoId: string, servicioId: string): void {
  sql(`
    UPDATE public.inscripciones_servicios SET estado = 'CANCELADA'
    WHERE alumno_id = '${alumnoId}' AND servicio_id = '${servicioId}' AND estado = 'ACTIVA';
  `)
}

/** Cancela todo el transporte activo del alumno. */
export function cancelarTransporte(alumnoId: string): void {
  sql(`
    UPDATE public.inscripciones_servicios i SET estado = 'CANCELADA'
    FROM public.servicios_escolares s
    WHERE i.servicio_id = s.id AND s.tipo = 'TRANSPORTE'
      AND i.alumno_id = '${alumnoId}' AND i.estado = 'ACTIVA';
  `)
}

/**
 * Borra TODOS los accesos y anulaciones. Solo para dejar el escenario
 * determinista: las tablas son de solo agregado y la aplicación no puede hacerlo;
 * esta limpieza desactiva las guardas dentro de su propia transacción local.
 */
export function limpiarAccesos(): void {
  sql(`
    BEGIN;
    ALTER TABLE public.anulaciones_accesos_servicios DISABLE TRIGGER USER;
    ALTER TABLE public.accesos_servicios DISABLE TRIGGER USER;
    DELETE FROM public.anulaciones_accesos_servicios;
    DELETE FROM public.accesos_servicios;
    ALTER TABLE public.accesos_servicios ENABLE TRIGGER USER;
    ALTER TABLE public.anulaciones_accesos_servicios ENABLE TRIGGER USER;
    COMMIT;
  `)
}

export function limpiarContadores(): void {
  sql('DELETE FROM app_private.contadores_escaneo;')
}

export function contarContadores(dni: string, tipo?: 'SOLICITUD' | 'INVALIDO' | 'BLOQUEO'): number {
  return Number(
    sql(`
      SELECT count(*) FROM app_private.contadores_escaneo c
      JOIN public.perfiles p ON p.id = c.operador_perfil_id
      WHERE p.dni = '${dni}'${tipo ? ` AND c.tipo = '${tipo}'` : ''};
    `)
  )
}

export function contarAccesos(alumnoId?: string, resultado?: 'REGISTRADO' | 'DENEGADO'): number {
  const condiciones = [
    alumnoId ? `alumno_id = '${alumnoId}'` : null,
    resultado ? `resultado = '${resultado}'` : null,
  ].filter(Boolean)
  return Number(
    sql(`SELECT count(*) FROM public.accesos_servicios${condiciones.length ? ` WHERE ${condiciones.join(' AND ')}` : ''};`)
  )
}

export function ultimoAcceso(alumnoId: string, resultado: 'REGISTRADO' | 'DENEGADO') {
  const fila = sql(`
    SELECT id || '|' || coalesce(motivo_denegacion::text, '') || '|' || coalesce(sentido::text, '')
    FROM public.accesos_servicios
    WHERE alumno_id = '${alumnoId}' AND resultado = '${resultado}'
    ORDER BY registrado_en DESC LIMIT 1;
  `)
  const [id, motivo, sentido] = fila.split('|')
  return { id, motivo: motivo || null, sentido: sentido || null }
}

export function idPerfil(dni: string): string {
  const id = sql(`SELECT id FROM public.perfiles WHERE dni = '${dni}';`)
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error(`No se encontró el perfil con DNI ${dni}.`)
  return id
}

export function nuevoIntento(): string {
  return randomUUID()
}

// ---------------------------------------------------------------------------
// Video falso de cámara para Chromium (solo desktop)
// ---------------------------------------------------------------------------

/**
 * Escribe un archivo Y4M con el QR del texto indicado, para
 * `--use-file-for-fake-video-capture`. Lo genera en el directorio temporal del
 * sistema: nunca dentro del repositorio ni de la evidencia, porque contiene un QR
 * que, aunque efímero, tiene el formato del real.
 */
export function escribirVideoFalsoY4m(texto: string, ancho = 640, alto = 480, cuadros = 20): string {
  const matriz = encodeQR(texto, 'raw') as boolean[][]
  const modulos = matriz.length
  const zona = 4
  const lado = modulos + zona * 2
  const escala = Math.max(1, Math.floor(Math.min(ancho, alto) / lado))
  const origenX = Math.floor((ancho - lado * escala) / 2)
  const origenY = Math.floor((alto - lado * escala) / 2)

  const y = Buffer.alloc(ancho * alto, 235)
  for (let fila = 0; fila < modulos; fila += 1) {
    for (let col = 0; col < modulos; col += 1) {
      if (!matriz[fila][col]) continue
      for (let dy = 0; dy < escala; dy += 1) {
        const py = origenY + (fila + zona) * escala + dy
        const inicio = py * ancho + origenX + (col + zona) * escala
        y.fill(16, inicio, inicio + escala)
      }
    }
  }
  const u = Buffer.alloc((ancho / 2) * (alto / 2), 128)
  const cabecera = Buffer.from(`YUV4MPEG2 W${ancho} H${alto} F30:1 Ip A1:1 C420jpeg\n`)
  const cuadro = Buffer.concat([Buffer.from('FRAME\n'), y, u, u])
  const ruta = path.join(os.tmpdir(), `ept65-video-${randomUUID()}.y4m`)
  fs.writeFileSync(ruta, Buffer.concat([cabecera, ...Array.from({ length: cuadros }, () => cuadro)]))
  return ruta
}

/** Imagen GIF del QR del texto (para la alternativa de fotografía), como un `File`-like. */
export function gifDelQr(texto: string): { name: string; mimeType: string; buffer: Buffer } {
  const bytes = encodeQR(texto, 'gif', { scale: 8, border: 4 }) as Uint8Array
  return { name: 'foto-qr.gif', mimeType: 'image/gif', buffer: Buffer.from(bytes) }
}
