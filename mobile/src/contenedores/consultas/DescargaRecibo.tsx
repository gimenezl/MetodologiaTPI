import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Aviso, Boton } from "@/catalogo";
import { compartirRecibo } from "@/servicios/recibos";
import type { ClienteEPT } from "@/servicios/supabase";

export function DescargaRecibo({
  cliente,
  reciboId,
}: {
  cliente: ClienteEPT;
  reciboId: string;
}) {
  const [cerrado, setCerrado] = useState(false);
  const control = useRef<AbortController | null>(null);
  const [estado, setEstado] = useState<{
    cargando: boolean;
    bytes: number;
    error: string | null;
  }>({ cargando: false, bytes: 0, error: null });
  useEffect(
    () => () => {
      control.current?.abort();
      control.current = null;
    },
    [cliente, reciboId],
  );
  const descargar = async () => {
    if (control.current) return;
    const c = new AbortController();
    control.current = c;
    const timeout = setTimeout(() => c.abort(), 60000);
    setCerrado(false);
    setEstado({ cargando: true, bytes: 0, error: null });
    try {
      await compartirRecibo(cliente, reciboId, c.signal, (bytes) => {
        if (!c.signal.aborted)
          setEstado({ cargando: true, bytes, error: null });
      });
      if (!c.signal.aborted) {
        setEstado({ cargando: false, bytes: 0, error: null });
        setCerrado(true);
      }
    } catch (e) {
      if (control.current === c)
        setEstado({
          cargando: false,
          bytes: 0,
          error: c.signal.aborted
            ? "Descarga cancelada. Puedes reintentar."
            : e instanceof Error
              ? e.message
              : "No se pudo descargar. Reintenta.",
        });
    } finally {
      clearTimeout(timeout);
      if (control.current === c) control.current = null;
    }
  };
  return (
    <View>
      <Boton
        etiqueta={
          estado.cargando ? "Preparando recibo…" : "Descargar recibo PDF"
        }
        cargando={estado.cargando}
        onPress={() => void descargar()}
        testID="recibo-descargar"
      />
      {estado.cargando ? (
        <>
          <Text accessibilityLiveRegion="polite">
            Recibidos {estado.bytes} bytes
          </Text>
          <Boton
            etiqueta="Cancelar descarga"
            variante="enlace"
            onPress={() => control.current?.abort()}
          />
        </>
      ) : null}
      {cerrado ? (
        <Text accessibilityLiveRegion="polite">
          Menú de descarga cerrado. Temporal eliminado.
        </Text>
      ) : null}
      {estado.error ? (
        <Aviso tipo="error" mensaje={estado.error} anuncio="alerta" />
      ) : null}
    </View>
  );
}
