// The shell lists the framework so it does not rely on the toolchain
// bringing it (the toolchain peers on it from the ORM release after
// 8.0.0-rc.25). The shell's own code never imports it.
export const SHELL_ALLOWED_UNIMPORTED: readonly string[] = [
  "@prisma/orm-framework",
];
