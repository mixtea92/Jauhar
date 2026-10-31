// 57D7C0 — Browser-level mobile file upload restriction.
// Device identification is best-effort; a user agent can be spoofed.
export const MOBILE_UPLOAD_NOTICE =
  'File uploads are disabled on mobile. Please use a desktop browser.'

export function isMobileUploadBlocked(device = typeof navigator === 'undefined' ? null : navigator) {
  if (!device) return false
  const userAgent = device.userAgent || ''
  return Boolean(device.userAgentData?.mobile) ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && Number(device.maxTouchPoints || 0) > 1)
}
