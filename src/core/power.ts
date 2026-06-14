// Build-channel flag. The "power" build (`pnpm build:power`, CS_POWER=1 — distributed OFF-STORE via
// GitHub / load-unpacked / signed .xpi) compiles in the multi-mirror stream resolver. The store builds
// (`pnpm build` / build:firefox / build:edge, and everything `pnpm check` runs) leave CS_POWER unset, so
// __POWER__ folds to `false`, every `if (POWER) { … }` block is dead-code-eliminated, and the resolver
// never ships to the Web Store listing. The gate is verified by scripts/check-store-clean.mjs. See POWER.md.
//
// typeof-guard: vitest doesn't apply the Vite `define`, so there __POWER__ is undefined → POWER=false;
// at build time the define replaces __POWER__ with a boolean literal, so this folds to a constant.
declare const __POWER__: boolean;
export const POWER: boolean = typeof __POWER__ === 'boolean' ? __POWER__ : false;
