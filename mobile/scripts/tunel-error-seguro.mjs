// Restricted diagnostic values: never retain messages, addresses, hosts, URLs or paths.
const knownCodes = new Set([
  'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH',
  'EAI_AGAIN', 'ECONNABORTED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED', 'ABORT_ERR', 'UND_ERR_CONNECT_TIMEOUT',
])

export function safeErrorCode(error) {
  const code = error?.code ?? error?.cause?.code
  return typeof code === 'string' && knownCodes.has(code) ? code : 'UNKNOWN'
}

export function describeTunnelFailure({ direct, dns, fallback }) {
  const validDns = new Set(['unavailable', 'no_address', 'resolved', 'error'])
  return `direct=${safeErrorCode(direct)}; dns=${validDns.has(dns) ? dns : 'unavailable'}; fallback=${fallback === null ? 'NOT_ATTEMPTED' : safeErrorCode(fallback)}`
}
