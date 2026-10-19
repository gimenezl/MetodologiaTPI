"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabaseClient } from "@/services/supabase.server";
export async function recuperarReciboAccion(
  form: FormData,
): Promise<{ mensaje: string }> {
  const pago = form.get("pago");
  if (!z.uuid().safeParse(pago).success)
    return { mensaje: "El pago no es válido." };
  const cliente = await createServerSupabaseClient();
  const { error } = await cliente.rpc("recuperar_recibo", {
    p_pago_id: pago as string,
  });
  if (error)
    return {
      mensaje:
        error.code === "42501"
          ? "Solo Dirección habilitada puede recuperar el recibo."
          : "No se pudo preparar el recibo. El pago se conserva. Reintenta.",
    };
  revalidatePath("/dashboard/comprobantes");
  return { mensaje: "Recibo preparado. Puedes descargarlo." };
}
