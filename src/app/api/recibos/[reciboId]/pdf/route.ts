import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  autenticarBearer,
  extraerToken,
} from "@/services/autenticacion-bearer";
import { createServerSupabaseClient } from "@/services/supabase.server";
import { generarReciboPdf } from "@/services/recibos-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Authorization",
};
const falla = (estado: number, mensaje: string) =>
  Response.json({ mensaje }, { status: estado, headers });

/** Bytes autenticados, nunca redirecciones ni URL de Storage. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ reciboId: string }> },
) {
  const { reciboId } = await params;
  if (!z.uuid().safeParse(reciboId).success)
    return falla(400, "El identificador de recibo no es válido.");
  try {
    let cliente;
    if (request.headers.has("authorization")) {
      const identidad = await autenticarBearer(request.headers);
      if (!identidad.ok) return falla(identidad.estado, identidad.mensaje);
      cliente = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
          global: {
            headers: {
              Authorization: `Bearer ${extraerToken(request.headers.get("authorization"))}`,
            },
          },
        },
      );
    } else {
      cliente = await createServerSupabaseClient();
      const { data, error } = await cliente.auth.getUser();
      if (error || !data.user)
        return falla(401, "Inicia sesión para descargar el recibo.");
    }
    const consultar = () =>
      cliente.rpc("consultar_recibo", { p_recibo_id: reciboId });
    const { data, error } = await consultar();
    if (error)
      return falla(
        error.code === "42501" ? 403 : 503,
        error.code === "42501"
          ? "No tienes permiso para acceder a este recibo."
          : "El recibo no está disponible. Reintenta.",
      );
    let bytes: Uint8Array;
    try {
      bytes = await generarReciboPdf(data);
    } catch {
      return falla(
        503,
        "No se pudo generar el PDF. El pago y el número de recibo se conservan. Reintenta.",
      );
    }
    // No entregar bytes si se revocó la autorización durante un render prolongado.
    const vigente = await consultar();
    if (vigente.error)
      return falla(
        vigente.error.code === "42501" ? 403 : 503,
        "No se pudo confirmar el permiso de descarga.",
      );
    return new Response(Buffer.from(bytes), {
      headers: {
        ...headers,
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.length),
        "Content-Disposition": `attachment; filename="recibo-${reciboId}.pdf"`,
      },
    });
  } catch {
    return falla(503, "No se pudo completar la descarga. Reintenta.");
  }
}
