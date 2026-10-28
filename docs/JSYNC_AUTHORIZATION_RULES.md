# JSYNC Global Authorization Policy (mandatory)
System Admin is VIEW ALL + MANAGE SYSTEM, not a business approver.
System Admin can view every current and future module, including PV, delegation, payment, budget, and audit.
System Admin cannot raise, create, submit, edit, approve, return, reject, revoke, archive, or complete business transactions.
Only User Management permits System Admin to manage accounts, roles, departments, subdepartments, branches, designations, Cost Centers and passwords.
For every new module:
1. Build separate System Admin read-only page or mode with no mutation controls.
2. Enforce read/write separation in Supabase RLS, functions and Edge Functions, not just UI.
3. Test that System Admin can view but cannot mutate.
4. Preserve approved roles, workflows, payment processes, delegation, and audited records.
5. Never infer approval rights from Cost Center or Department.
Manage Delegation: Finance Executive/Manager, CEO, BOD retain existing scoped authority; System Admin is viewer only; other departments cannot manage it.
