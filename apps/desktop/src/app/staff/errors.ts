import { staffErrorCode } from '@/store/staff'

// Friendly copy for the error_code values the staff endpoints can return (see
// hermes.ts / store/staff.ts). Anything not listed here falls back to the
// caller-supplied generic message.
const STAFF_ERROR_MESSAGES: Record<string, string> = {
  already_hired: 'You already hired this agent.',
  invalid_license: 'That license key is not valid.',
  pro_required: 'This agent requires a Pro license.',
  slots_full: 'All of your staff slots are full. Fire an agent or upgrade to Pro for more room.'
}

// Translate a thrown hermes error into a message the user can act on, falling
// back to a generic summary when the backend didn't attach a known error_code.
export function staffFriendlyError(err: unknown, fallback: string): string {
  const code = staffErrorCode(err)

  return (code ? STAFF_ERROR_MESSAGES[code] : undefined) ?? fallback
}

export { staffErrorCode }
