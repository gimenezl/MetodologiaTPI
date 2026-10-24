import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Text } from "react-native";
import {
  Aviso,
  Boton,
  EstadoPantalla,
  MarcoPantalla,
  PantallaConVolver,
} from "@/catalogo";
import { compartirPdfPrivado } from "@/servicios/recibos";
// Fixture PDF sintético mínimo, una página sin datos personales. Solo QA explícito, nunca autorización.
const SINTETICO =
  "JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgKHB5cGRmKQo+PgplbmRvYmoKMiAwIG9iago8PAovVHlwZSAvUGFnZXMKL0NvdW50IDEKL0tpZHMgWyA0IDAgUiBdCj4+CmVuZG9iagozIDAgb2JqCjw8Ci9UeXBlIC9DYXRhbG9nCi9QYWdlcyAyIDAgUgo+PgplbmRvYmoKNCAwIG9iago8PAovVHlwZSAvUGFnZQovUmVzb3VyY2VzIDw8Ci9Gb250IDw8Ci9GMSA1IDAgUgo+Pgo+PgovTWVkaWFCb3ggWyAwLjAgMC4wIDU5NSA4NDIgXQovUGFyZW50IDIgMCBSCi9Db250ZW50cyA2IDAgUgo+PgplbmRvYmoKNSAwIG9iago8PAovVHlwZSAvRm9udAovU3VidHlwZSAvVHlwZTEKL0Jhc2VGb250IC9IZWx2ZXRpY2EKPj4KZW5kb2JqCjYgMCBvYmoKPDwKL0xlbmd0aCA3OAo+PgpzdHJlYW0KQlQgL0YxIDE0IFRmIDQ1IDc4MCBUZCAoUmVjaWJvIHNpbnRldGljbyBFUFQtMTEzLCBRQSBuYXRpdm8gc2luIGJhY2tlbmQpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDcKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAwNTQgMDAwMDAgbiAKMDAwMDAwMDExMyAwMDAwMCBuIAowMDAwMDAwMTYyIDAwMDAwIG4gCjAwMDAwMDAyOTQgMDAwMDAgbiAKMDAwMDAwMDM2NCAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDcKL1Jvb3QgMyAwIFIKL0luZm8gMSAwIFIKPj4Kc3RhcnR4cmVmCjQ5MgolJUVPRgo=";
export default function ReciboPrueba() {
  const router = useRouter();
  const ocupado = useRef(false);
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");
  if (Constants.expoConfig?.extra?.eptRecibosNativeQa !== true)
    return (
      <EstadoPantalla
        tipo="error"
        titulo="Acceso restringido"
        descripcion="Esta verificación no está habilitada."
      />
    );
  async function probar() {
    if (ocupado.current) return;
    ocupado.current = true;
    setError("");
    setMensaje("Preparando PDF sintético…");
    try {
      const bytes = Uint8Array.from(atob(SINTETICO), (c) => c.charCodeAt(0));
      await compartirPdfPrivado(
        bytes,
        "b1130000-0000-4000-8000-000000000001",
        new AbortController().signal,
      );
      setMensaje("Menú nativo cerrado. Temporal eliminado.");
    } catch {
      setError("No se pudo completar la verificación nativa.");
      setMensaje("");
    } finally {
      ocupado.current = false;
    }
  }
  return (
    <MarcoPantalla>
      <PantallaConVolver onVolver={() => router.back()}>
        <Text accessibilityRole="header">Verificación nativa de recibo</Text>
        <Text>
          PDF sintético. No prueba autorización, descarga Bearer ni backend.
        </Text>
        <Boton
          etiqueta="Compartir PDF sintético"
          onPress={() => void probar()}
        />
        <Text accessibilityLiveRegion="polite">{mensaje}</Text>
        {error ? <Aviso tipo="error" mensaje={error} /> : null}
      </PantallaConVolver>
    </MarcoPantalla>
  );
}
