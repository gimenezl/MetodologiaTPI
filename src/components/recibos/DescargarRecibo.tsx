"use client";
import { useEffect, useRef, useState } from "react";
export function DescargarRecibo({ reciboId }: { reciboId: string }) {
  const control = useRef<AbortController | null>(null);
  const [estado, setEstado] = useState("");
  useEffect(
    () => () => {
      control.current?.abort();
    },
    [reciboId],
  );
  async function descargar() {
    if (control.current) return;
    const c = new AbortController();
    control.current = c;
    setEstado("Preparando recibo…");
    try {
      const r = await fetch(`/api/recibos/${reciboId}/pdf`, {
        redirect: "error",
        credentials: "same-origin",
        cache: "no-store",
        signal: c.signal,
      });
      if (!r.ok)
        throw new Error(
          r.status === 401
            ? "Inicia sesión nuevamente."
            : r.status === 403
              ? "No tienes permiso para descargar el recibo."
              : "No se pudo generar el PDF. Reintenta; el pago se conserva.",
        );
      if (r.headers.get("content-type") !== "application/pdf")
        throw new Error("El servidor no entregó un PDF válido.");
      const b = await r.blob();
      if (
        b.size < 100 ||
        b.size > 5 * 1024 * 1024 ||
        (await b.slice(0, 5).text()) !== "%PDF-"
      )
        throw new Error("El PDF no es válido.");
      if (c.signal.aborted) return;
      const url = URL.createObjectURL(b);
      const a = document.createElement("a");
      a.href = url;
      a.download = `recibo-${reciboId}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setEstado("Recibo descargado.");
    } catch (e) {
      if (!c.signal.aborted)
        setEstado(
          e instanceof Error ? e.message : "No se pudo descargar. Reintenta.",
        );
    } finally {
      if (control.current === c) control.current = null;
    }
  }
  return (
    <div>
      <button
        type="button"
        className="min-h-11 text-sm font-semibold underline disabled:opacity-50"
        onClick={() => void descargar()}
        disabled={estado === "Preparando recibo…"}
      >
        Descargar recibo PDF
      </button>
      <p role="status" className="text-sm">
        {estado}
      </p>
    </div>
  );
}
