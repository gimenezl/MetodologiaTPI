import { createAdminClient } from "@/services/supabase.admin";
import { enviarCorreoEstructurado, leerConfiguracionSmtp, type ConfiguracionSmtp } from "@/services/correo.server";
import { generarFacturaPdf } from "@/services/factura-pdf";
import { armarRecordatorio, datosRecordatorioSchema, nombreAdjunto } from "@/services/recordatorio-correo";

type Cliente = ReturnType<typeof createAdminClient>;
type Candidato = { padre_id: string; fecha_programada: string };
type Resultado = "enviado" | "fallido" | "incierto" | "omitido" | "sin_confirmar";

/**
 * El lote cabe en el presupuesto de la ruta (maxDuration 60 s): no se inicia otro
 * padre pasados 30 s, y el peor caso por padre es ~20 s (SMTP 5+5+10 s).
 */
const LIMITE_PARA_INICIAR_MS = 30_000;
const MAXIMO_POR_EJECUCION = 100;
const CORREO_VALIDO = /^[^\s@<>()"]{1,64}@[^\s@<>()"]{1,255}$/u;

type Args = { p_padre: string; p_fecha: string; p_token: string };

/** Persiste el resultado. Tras una respuesta perdida consulta el estado ANTES de repetir. */
async function confirmar(
  db: Cliente,
  args: Args,
  intento: number,
  estado: "ENVIADO" | "FALLIDO" | "INCIERTO",
  error: string | null,
): Promise<boolean> {
  const llamada = { ...args, p_estado: estado, p_error: error ?? "" };
  const primera = await db.rpc("recordatorio_resultado_job", llamada);
  if (!primera.error && primera.data === true) return true;
  const leido = await db.rpc("recordatorio_estado_job", { p_padre: args.p_padre, p_fecha: args.p_fecha });
  const actual = leido.data as { estado: string | null; intentos: number } | null;
  if (!leido.error && actual) {
    if (actual.estado === estado && actual.intentos === intento) return true; // ya confirmado
    if (actual.estado !== "PENDIENTE") return false; // otro actor lo resolvió (p. ej. barrido)
  } else {
    return false; // sin lectura no se repite a ciegas
  }
  const segunda = await db.rpc("recordatorio_resultado_job", llamada);
  return !segunda.error && segunda.data === true;
}

async function procesar(db: Cliente, smtp: ConfiguracionSmtp, c: Candidato): Promise<Resultado> {
  const reserva = await db.rpc("recordatorio_reservar_job", { p_padre: c.padre_id, p_fecha: c.fecha_programada });
  if (reserva.error) return "sin_confirmar"; // la reserva vence sola; sin frontera se retoma
  const r = reserva.data as { reservado: boolean; token?: string; intento?: number };
  if (!r.reservado || !r.token || !r.intento) return "omitido";
  const args: Args = { p_padre: c.padre_id, p_fecha: c.fecha_programada, p_token: r.token };
  const intento = r.intento;

  // Fallo claro ANTES de SMTP: nada pudo salir.
  const fallar = async (motivo: string): Promise<Resultado> =>
    (await confirmar(db, args, intento, "FALLIDO", motivo)) ? "fallido" : "sin_confirmar";

  const datos = await db.rpc("recordatorio_datos_job", args);
  if (datos.error) return "sin_confirmar";
  const crudo = datos.data as { impedimento?: string };
  if (crudo.impedimento) return fallar(crudo.impedimento);
  const analizado = datosRecordatorioSchema.safeParse(datos.data);
  if (!analizado.success) return fallar("Los datos canónicos del recordatorio son inválidos.");
  const d = analizado.data;

  const usuario = await db.auth.admin.getUserById(d.user_id);
  const correo = usuario.data.user?.email ?? "";
  if (usuario.error || !CORREO_VALIDO.test(correo)) return fallar("El destinatario no tiene un correo válido.");

  let mensaje;
  let adjuntos;
  try {
    mensaje = armarRecordatorio(d);
    adjuntos = await Promise.all(
      d.hijos.map(async (h, i) => ({
        nombre: nombreAdjunto(h.alumno, d.periodo, i),
        contenido: await generarFacturaPdf(h),
        tipo: "application/pdf",
      })),
    );
  } catch {
    return fallar("No se pudo generar el correo o alguna factura en PDF.");
  }

  // Frontera: desde aquí una aceptación SMTP es posible. Si no se confirma la marca, no se envía.
  const cruce = await db.rpc("recordatorio_frontera_job", args);
  if (cruce.error || cruce.data !== true) return "sin_confirmar";

  const envio = await enviarCorreoEstructurado(smtp, { destinatario: correo, ...mensaje, adjuntos });
  if (envio.estado === "ACEPTADO") {
    return (await confirmar(db, args, intento, "ENVIADO", null)) ? "enviado" : "sin_confirmar";
  }
  if (envio.estado === "FALLO_CLARO") {
    return (await confirmar(db, args, intento, "FALLIDO", envio.causa)) ? "fallido" : "sin_confirmar";
  }
  return (await confirmar(db, args, intento, "INCIERTO", envio.causa)) ? "incierto" : "sin_confirmar";
}

/** Reloj y destinatarios salen de PostgreSQL: la petición no aporta fecha, destino ni importes. */
export async function ejecutarRecordatorio() {
  const db = createAdminClient(5_000);
  const conteos = { enviados: 0, fallidos: 0, inciertos: 0, omitidos: 0, sin_confirmar: 0 };
  const plan = await db.rpc("recordatorio_plan_job");
  if (plan.error) throw new Error("No se pudo consultar el plan del recordatorio.");
  const datos = plan.data as { habilitada: boolean; candidatos: Candidato[] };
  if (!datos.habilitada) return { habilitada: false, smtp_configurado: true, restantes: 0, ...conteos };
  const smtp = leerConfiguracionSmtp();
  if (!smtp) return { habilitada: true, smtp_configurado: false, restantes: datos.candidatos.length, ...conteos };

  const inicio = Date.now();
  let procesados = 0;
  for (const c of datos.candidatos) {
    if (procesados >= MAXIMO_POR_EJECUCION || Date.now() - inicio >= LIMITE_PARA_INICIAR_MS) break;
    procesados += 1;
    try {
      const r = await procesar(db, smtp, c);
      if (r === "enviado") conteos.enviados += 1;
      else if (r === "fallido") conteos.fallidos += 1;
      else if (r === "incierto") conteos.inciertos += 1;
      else if (r === "omitido") conteos.omitidos += 1;
      else conteos.sin_confirmar += 1;
    } catch {
      // Desenlace desconocido: no se repite el despacho.
      conteos.sin_confirmar += 1;
    }
  }
  return { habilitada: true, smtp_configurado: true, restantes: datos.candidatos.length - procesados, ...conteos };
}
