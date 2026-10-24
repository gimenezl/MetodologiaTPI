"use client";
import { useActionState } from "react";
import { recuperarReciboAccion } from "@/services/recibos-acciones";
export function RecuperarRecibo({ pagoId }: { pagoId: string }) {
  const [estado, accion, pendiente] = useActionState(
    async (_: { mensaje: string }, f: FormData) => recuperarReciboAccion(f),
    { mensaje: "" },
  );
  return (
    <form action={accion}>
      <input type="hidden" name="pago" value={pagoId} />
      <button disabled={pendiente} className="min-h-11 underline">
        {pendiente ? "Preparando recibo…" : "Preparar recibo institucional"}
      </button>
      <p role="status">{estado.mensaje}</p>
    </form>
  );
}
