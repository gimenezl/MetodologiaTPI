import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Aviso, Boton } from "@/catalogo";
import { compartirRecibo } from "@/servicios/recibos";
import type { ClienteEPT } from "@/servicios/supabase";
import { color, espacio, estiloDeTexto } from "@/tokens";

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
  const [contexto, setContexto] = useState({ cliente, reciboId });
  // Ajuste condicional al cambiar props: no arrastra el estado de otro recibo/cuenta.
  if (contexto.cliente !== cliente || contexto.reciboId !== reciboId) {
    setContexto({ cliente, reciboId });
    setCerrado(false);
    setEstado({ cargando: false, bytes: 0, error: null });
  }
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
      await compartirRecibo(
        cliente,
        reciboId,
        c.signal,
        (bytes) => {
          if (control.current === c && !c.signal.aborted)
            setEstado({ cargando: true, bytes, error: null });
        },
        () => clearTimeout(timeout),
      );
      if (control.current === c) {
        setEstado({ cargando: false, bytes: 0, error: null });
        setCerrado(!c.signal.aborted);
      }
    } catch (e) {
      if (control.current === c)
        setEstado({
          cargando: false,
          bytes: 0,
          error: c.signal.aborted
            ? "Se canceló la descarga. Podés volver a intentarlo."
            : e instanceof Error
              ? e.message
              : "No pudimos descargar el recibo. Revisá tu conexión e intentá de nuevo.",
        });
    } finally {
      clearTimeout(timeout);
      if (control.current === c) control.current = null;
    }
  };
  return (
    <View style={{ gap: espacio.sm }}>
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
          <Text
            accessibilityLiveRegion="polite"
            style={[estiloDeTexto("pie"), { color: color.neutro600 }]}
          >
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
        <Text
          accessibilityLiveRegion="polite"
          style={[estiloDeTexto("cuerpo"), { color: color.neutro700 }]}
        >
          Menú de descarga cerrado. Temporal eliminado.
        </Text>
      ) : null}
      {estado.error ? (
        <Aviso tipo="error" mensaje={estado.error} anuncio="alerta" />
      ) : null}
    </View>
  );
}
