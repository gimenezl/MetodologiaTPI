export function withCleanup(operation, cleanups) {
  const errors = []
  let value
  try { value = operation() } catch (error) { errors.push(error) }
  for (const cleanup of cleanups) {
    try { cleanup() } catch (error) { errors.push(error) }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length) throw new AggregateError(errors, 'Ejecución y limpieza fallaron', { cause: errors[0] })
  return value
}
