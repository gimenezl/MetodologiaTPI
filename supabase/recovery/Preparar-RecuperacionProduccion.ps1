[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$DirectorioSalida
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$raizRepositorio = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$directorioMigraciones = Join-Path $raizRepositorio 'supabase\migrations'
$salida = [IO.Path]::GetFullPath($DirectorioSalida)

if (Test-Path -LiteralPath $salida) {
  if ((Get-ChildItem -LiteralPath $salida -Force | Select-Object -First 1)) {
    throw "El directorio de salida debe estar vacío: $salida"
  }
} else {
  New-Item -ItemType Directory -Path $salida | Out-Null
}

$hashesEsperados = [ordered]@{
  '001_initial_schema.sql'                   = 'B7492C88F5E6070E414944760D74DE4EB03D91472A44A9F78D2B2F091729D53F'
  '002_postulaciones.sql'                    = '2BB053C63817B6C0402522C2B975069540145FFD114E40B64B3FF0BCAEDA6AEB'
  '003_cursos.sql'                           = 'D5A13A855304B3C0ABDE184DAD699B1677BC7B8911F80E67687F8A49201C663A'
  '004_seguridad_roles_niveles.sql'          = '089E1B3363DB7A769BDA07BE8CAFEC8A19A0B3A903CB5D39F3BBF49340EF6954'
  '005_perfiles_sin_recursion.sql'           = 'F44BD7196A5A1F93A923CCDC6DC63DDB77863076B41B83DE5DC862AF3AB693EC'
  '006_administracion_niveles.sql'           = 'A93202CFB67749FD9CE00FCC593EFD5055A491155F65E60F1669E52D7276C740'
  '007_correcciones_integridad_niveles.sql'  = 'AE730F5D428A70327D7A934D619E44BF725194FD1C49E489B82D6C1B4A985EC2'
  '008_alumnos_estado_academico.sql'         = '006E7ADF87228172BA80CAEC4DF42AFC1D14BCC9C9DE7A8CB2560D706B4CDFE1'
  '009_correcciones_revision_alumnos.sql'    = 'B269BB36CB6672429293F73649E4835BFC2D23FD0A3629085886F19465DE2650'
  '010_alta_atomica_de_cuentas.sql'           = '858F6B21B5255FF49C97D183CACB3142AA6089FC21D5FA3CCC0D429EE9B0BAD9'
  '011_reconciliacion_esquema_remoto.sql'     = 'F010EFD7983F7211649931FED478B31F8C18C252B49422399CAB295F717099D1'
}

foreach ($entrada in $hashesEsperados.GetEnumerator()) {
  $ruta = Join-Path $directorioMigraciones $entrada.Key
  if (-not (Test-Path -LiteralPath $ruta -PathType Leaf)) {
    throw "Falta la migración esperada: $($entrada.Key)"
  }

  $real = (Get-FileHash -LiteralPath $ruta -Algorithm SHA256).Hash
  if ($real -ne $entrada.Value) {
    throw "Hash inesperado para $($entrada.Key). Esperado $($entrada.Value); real $real."
  }
}

# El primer paquete contiene únicamente 001–007. Después de reconciliar el
# ledger remoto, Supabase omite 001/002 y aplica 003–007 sin llegar a 008.
$faseUno = Join-Path $salida 'fase-1-003-a-007\supabase'
$faseUnoMigraciones = Join-Path $faseUno 'migrations'
New-Item -ItemType Directory -Path $faseUnoMigraciones -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $raizRepositorio 'supabase\config.toml') -Destination $faseUno

foreach ($nombre in @($hashesEsperados.Keys)[0..6]) {
  Copy-Item -LiteralPath (Join-Path $directorioMigraciones $nombre) -Destination $faseUnoMigraciones
}

# 008 se mantiene inmutable en Git. Este derivado agrega una transacción
# explícita y fuerza los triggers diferidos antes del ALTER TABLE que, con
# perfiles ESTUDIANTE preexistentes, falla con SQLSTATE 55006.
$ruta008 = Join-Path $directorioMigraciones '008_alumnos_estado_academico.sql'
$utf8Estricto = [Text.UTF8Encoding]::new($false, $true)
$contenido008 = $utf8Estricto.GetString([IO.File]::ReadAllBytes($ruta008))
$marcador = 'ALTER TABLE public.alumnos ENABLE ROW LEVEL SECURITY;'

if (($contenido008.Split($marcador).Count - 1) -ne 1) {
  throw '008 no contiene exactamente un marcador ALTER TABLE esperado.'
}

$prefijo = "BEGIN;`r`n-- Derivado operacional exacto de 008 SHA-256 $($hashesEsperados['008_alumnos_estado_academico.sql']).`r`n"
$reemplazo = "SET CONSTRAINTS ALL IMMEDIATE;`r`n`r`n$marcador"
$derivado = $prefijo + $contenido008.Replace($marcador, $reemplazo)
if (-not $derivado.EndsWith("`r`n")) { $derivado += "`r`n" }
$derivado += "COMMIT;`r`n"

$rutaDerivado = Join-Path $salida '008_alumnos_estado_academico_operacional.sql'
[IO.File]::WriteAllText($rutaDerivado, $derivado, $utf8Estricto)

$hashDerivado = (Get-FileHash -LiteralPath $rutaDerivado -Algorithm SHA256).Hash
$hashDerivadoEsperado = '53A0E2D0BC8FA626A35C8705DB1C1B77C57E2C02873159E2A300B0C5B6C1600D'
if ($hashDerivado -ne $hashDerivadoEsperado) {
  throw "El derivado de 008 no es reproducible. Esperado $hashDerivadoEsperado; real $hashDerivado."
}

$lineasManifest = @(
  "008_alumnos_estado_academico_operacional.sql|$hashDerivado"
)
foreach ($nombre in @($hashesEsperados.Keys)[0..6]) {
  $ruta = Join-Path $faseUnoMigraciones $nombre
  $lineasManifest += "$nombre|$((Get-FileHash -LiteralPath $ruta -Algorithm SHA256).Hash)"
}

$rutaManifest = Join-Path $salida 'MANIFEST-SHA256.txt'
[IO.File]::WriteAllLines($rutaManifest, $lineasManifest, $utf8Estricto)

Write-Host 'Paquete operacional preparado sin conectarse a ninguna base.'
Write-Host "Directorio: $salida"
Write-Host "SHA-256 derivado 008: $hashDerivado"
