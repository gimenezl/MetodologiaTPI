import Constants from "expo-constants";
import { fetch as fetchNativo } from "expo/fetch";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { entornoDelBundle } from "@/configuracion/entorno";
import { obtenerTokenDeAcceso } from "@/servicios/sesion";
import type { ClienteEPT } from "@/servicios/supabase";
import { validarBaseUrl } from "@/servicios/transporte-http";

const MAXIMO = 5 * 1024 * 1024;
let ocupado = false;
let compartiendo = false;
const ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;

/** Valida antes de escribir: no basta extensión, MIME o cabecera declarada. */
export async function leerPdfRespuesta(
  respuesta: Response,
  senal: AbortSignal,
  progreso: (bytes: number) => void,
): Promise<Uint8Array> {
  if (!respuesta.ok)
    throw new Error(
      respuesta.status === 401
        ? "La sesión venció. Inicia sesión nuevamente."
        : respuesta.status === 403
          ? "No tienes permiso para descargar este recibo."
          : "El recibo no está disponible. Reintenta.",
    );
  if (
    respuesta.redirected ||
    respuesta.headers.get("content-type")?.split(";")[0].trim() !==
      "application/pdf"
  )
    throw new Error("La respuesta no es un PDF válido.");
  const declarado = respuesta.headers.get("content-length");
  if (declarado && (!/^\d+$/u.test(declarado) || Number(declarado) > MAXIMO))
    throw new Error("El recibo supera el tamaño permitido.");
  const lector = respuesta.body?.getReader();
  if (!lector) throw new Error("No se pudo leer el PDF.");
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      if (senal.aborted) throw new Error("Descarga cancelada.");
      const r = await lector.read();
      if (r.done) break;
      total += r.value.length;
      if (total > MAXIMO)
        throw new Error("El recibo supera el tamaño permitido.");
      partes.push(r.value);
      progreso(total);
    }
  } catch (e) {
    await lector.cancel().catch(() => {});
    throw e;
  } finally {
    lector.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let posicion = 0;
  for (const p of partes) {
    bytes.set(p, posicion);
    posicion += p.length;
  }
  const firma = String.fromCharCode(...bytes.slice(0, 5));
  const fin = String.fromCharCode(...bytes.slice(-1024));
  if (
    total < 100 ||
    firma !== "%PDF-" ||
    !fin.includes("%%EOF") ||
    (declarado && Number(declarado) !== total)
  )
    throw new Error("El PDF está incompleto o no es válido.");
  return bytes;
}

/** Acción explícita: bytes del mismo origen con Bearer, archivo privado y menú nativo de compartir. */
export async function compartirRecibo(
  cliente: ClienteEPT,
  reciboId: string,
  senal: AbortSignal,
  progreso: (bytes: number) => void,
): Promise<void> {
  if (ocupado) throw new Error("Ya hay una descarga en curso.");
  if (!ID.test(reciboId)) throw new Error("El recibo no es válido.");
  ocupado = true;
  try {
    const entorno = entornoDelBundle();
    if (!entorno.ok) throw new Error("El servidor no está configurado.");
    const integracion =
      Constants.expoConfig?.extra?.eptAuthIntegration === true;
    const base = validarBaseUrl(
      entorno.entorno.apiBaseUrl,
      __DEV__ || integracion,
      integracion ? ["10.0.2.2"] : [],
    );
    const token = await obtenerTokenDeAcceso(cliente.auth);
    if (!token) throw new Error("Inicia sesión para descargar el recibo.");
    if (!(await Sharing.isAvailableAsync()))
      throw new Error("Este dispositivo no permite compartir archivos.");
    const destino = new URL(`/api/recibos/${reciboId}/pdf`, base);
    // expo/fetch implementa error de redirección ANTES de reenviar en Android/iOS.
    const respuesta = await fetchNativo(destino.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      credentials: "omit",
      signal: senal,
    });
    const bytes = await leerPdfRespuesta(
      respuesta as unknown as Response,
      senal,
      progreso,
    );
    if (senal.aborted || token !== (await obtenerTokenDeAcceso(cliente.auth)))
      throw new Error("El contexto de la sesión cambió. Consulta nuevamente.");
    await compartirPdfPrivado(bytes, reciboId, senal);
  } finally {
    ocupado = false;
  }
}

/** Frontera nativa compartida por descarga real y QA sintético del simulador iOS. */
export async function compartirPdfPrivado(
  bytes: Uint8Array,
  reciboId: string,
  senal: AbortSignal,
): Promise<void> {
  if (
    !ID.test(reciboId) ||
    bytes.length < 100 ||
    bytes.length > MAXIMO ||
    String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-"
  )
    throw new Error("El PDF no es válido.");
  if (compartiendo) throw new Error("Ya hay una descarga en curso.");
  compartiendo = true;
  let carpeta: Directory | undefined;
  try {
    carpeta = new Directory(Paths.cache, "recibos-institucionales");
    // Un único trabajo; elimina restos de un cierre inesperado anterior, nunca otras carpetas.
    if (carpeta.exists) carpeta.delete();
    carpeta.create();
    const archivo = new File(carpeta, `recibo-${reciboId}.pdf`);
    archivo.create();
    archivo.write(bytes);
    if (senal.aborted) throw new Error("Descarga cancelada.");
    await Sharing.shareAsync(archivo.uri, {
      mimeType: "application/pdf",
      UTI: "com.adobe.pdf",
      dialogTitle: "Guardar o compartir recibo institucional",
    });
  } finally {
    try {
      if (carpeta?.exists) carpeta.delete();
    } finally {
      compartiendo = false;
    }
  }
}

/** Limpieza al iniciar/cerrar sesión; no interrumpe un menú nativo abierto. */
export function limpiarRecibosTemporales(): void {
  if (ocupado || compartiendo) return;
  const carpeta = new Directory(Paths.cache, "recibos-institucionales");
  if (carpeta.exists) carpeta.delete();
}
