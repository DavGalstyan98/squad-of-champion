const configured = process.env.REACT_APP_API_URL || 'http://localhost:3001/api/v1'
// Docker uses a same-origin base; local CRA may use an explicit cross-origin URL.
const parsed = new URL(configured, window.location.origin)
if (
  (!configured.startsWith('/') && !/^https?:\/\//.test(configured)) ||
  configured.startsWith('//') ||
  !['http:', 'https:'].includes(parsed.protocol) ||
  parsed.username ||
  parsed.password ||
  parsed.search ||
  parsed.hash
) {
  throw new Error(
    'REACT_APP_API_URL must be an HTTP(S) or root-relative API base without credentials, query or fragment',
  )
}
export const apiUrl = configured.replace(/\/+$/, '')
