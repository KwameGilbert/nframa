// The admin areas a role can be granted access to. Adding one here makes it grantable everywhere
// (validation, docs, enforcement) — also add a migration granting it to super-admin, or re-run the seed.
export const MODULES = ["settings", "roles", "users"] as const;

export type Module = (typeof MODULES)[number];

export const ACTIONS = ["create", "read", "update", "delete"] as const;

export type Action = (typeof ACTIONS)[number];

export type ModuleActions = Record<Action, boolean>;

// Only modules with at least one action granted appear.
export type PermissionMap = Partial<Record<Module, ModuleActions>>;

export const SUPER_ADMIN_SLUG = "superadmin";

export function fullAccess(): PermissionMap {
  return Object.fromEntries(
    MODULES.map((module) => [module, { create: true, read: true, update: true, delete: true }]),
  );
}
