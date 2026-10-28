// Mandatory JSYNC authorization invariant.
// System Admin: VIEW ALL + MANAGE SYSTEM, no operational authority.
export const isActiveSystemAdmin = p => p?.role === 'system_admin' && p?.is_active === true
export const canViewAnyModule = p => isActiveSystemAdmin(p)
export const canManageSystemUsers = p => isActiveSystemAdmin(p)
export const canAccessPvManageDelegationPage = p => Boolean(p?.is_active === true && (
  isActiveSystemAdmin(p) ||
  (p?.department === 'Finance' && ['executive','manager'].includes(p?.role)) ||
  p?.role === 'ceo' || p?.role === 'bod'
))
export const canMutatePvDelegation = p => canAccessPvManageDelegationPage(p) && !isActiveSystemAdmin(p)
export const systemAdminIsBusinessReadOnly = p => isActiveSystemAdmin(p)
// UI defense only; database RLS and RPC must independently enforce write permissions.
