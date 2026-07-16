// A brand-new chat whose session row is not persisted yet resolves to a
// backend 404 "Session not found". The desktop IPC bridge formats that as an
// Error whose message is `404: {"detail":"Session not found"}`. The backend
// raises the literal "Session not found" from several endpoints, so match on
// that stable substring rather than the numeric status.
export function isSessionNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''

  return message.includes('Session not found')
}
