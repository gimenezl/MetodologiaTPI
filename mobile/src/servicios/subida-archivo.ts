import { File, UploadType } from 'expo-file-system'

import { entornoDelBundle } from '@/configuracion/entorno'
import { clasificarRespuestaSubida, type SubirArchivo } from '@/servicios/comprobantes'
import { obtenerTokenDeAcceso } from '@/servicios/sesion'
import { ErrorDeConfiguracion, obtenerClienteSupabase } from '@/servicios/supabase'

/**
 * Subida de un comprobante a la ruta TEMPORAL de su carga (EPT-109), con la sesión del padre.
 *
 * La URI se transmite como contenido binario directo desde el sistema de archivos del dispositivo (no
 * se carga en memoria de JavaScript ni se convierte a texto). Storage solo acepta esta escritura en una
 * ruta ya preparada y propia; `x-upsert: false` impide reemplazar un objeto existente.
 *
 * Una URI no prueba que los bytes se hayan subido: el resultado se toma de la respuesta de Storage.
 */
export function crearSubidaExpo(): SubirArchivo {
  return async ({ bucket, ruta, archivo, onProgreso, senal }) => {
    const resultado = entornoDelBundle()
    if (!resultado.ok) throw new ErrorDeConfiguracion(resultado.motivos)
    const { supabaseUrl, supabaseAnonKey } = resultado.entorno
    const cliente = obtenerClienteSupabase()
    const token = await obtenerTokenDeAcceso(cliente.auth)
    if (!token) return { tipo: 'rechazada', estado: 401 }

    // Cada segmento se codifica: la ruta es `<uuid>/<uuid>`, pero nunca se concatena sin escapar.
    const destino = `${supabaseUrl.replace(/\/$/u, '')}/storage/v1/object/${encodeURIComponent(bucket)}/${ruta
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`
    try {
      const tarea = new File(archivo.uri).createUploadTask(destino, {
        httpMethod: 'POST',
        uploadType: UploadType.BINARY_CONTENT,
        mimeType: archivo.tipoMime,
        headers: {
          apikey: supabaseAnonKey,
          authorization: `Bearer ${token}`,
          'content-type': archivo.tipoMime,
          'x-upsert': 'false',
          'cache-control': 'no-store',
        },
        // El progreso se informa como fracción: la barra nunca excede el 100 %.
        onProgress: ({ bytesSent, totalBytes }) => {
          if (totalBytes > 0) onProgreso(Math.min(1, Math.max(0, bytesSent / totalBytes)))
        },
        sessionType: 'foreground',
        signal: senal,
      })
      const r = await tarea.uploadAsync()
      return clasificarRespuestaSubida(r.status, r.body)
    } catch {
      // Cancelación, corte o archivo ilegible: no se sabe si llegó. Se resuelve finalizando (idempotente).
      return { tipo: 'incierto' }
    }
  }
}
