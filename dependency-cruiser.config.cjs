const frontendLayers = {
  lib: "lib",
  hooks: "lib|hooks",
  components: "lib|hooks|components",
  views: "lib|hooks|components|views",
}

const browserFrontendSource = {
  path: "^frontend/src/(lib|hooks|components|views)/",
  pathNot: [
    "^frontend/src/lib/server/",
    "[.](test|spec|test-support)[.][cm]?[jt]sx?$",
  ],
}

module.exports = {
  forbidden: [
    {
      name: "cube-does-not-import-host-or-tooling",
      severity: "error",
      from: { path: "^cube/" },
      to: { path: "^(standalone|probes)/" },
    },
    {
      name: "cube-does-not-touch-runtime-infrastructure",
      severity: "error",
      from: { path: "^cube/" },
      // One rule, four alternatives, because `to.path` is OR'd: the core modules,
      // then the PostgreSQL driver in each of the three shapes dependency-cruiser
      // 18.0.0 actually reports. A bare specifier is what an unresolved import
      // looks like; `node_modules/<pkg>` is a flat install; the `.pnpm` form is
      // what this repository resolves to, because `enhancedResolveOptions`
      // defaults to following symlinks and the 18.0.0 schema has no `symlinks`
      // property to turn that off (probed: the key is rejected as an additional
      // property). `dependencyTypes` is deliberately absent — adding it would
      // exclude the `core` edges this rule already catches.
      //
      // The `.pnpm` clause is its own string rather than an optional group inside
      // the previous one: `([.]pnpm/[^/]+/node_modules/)?` is rejected by the
      // cruiser's own "unsafe regular expression" check (a quantifier nested in an
      // optional group), and bailing out is not a passing gate.
      to: {
        path: [
          "^(node:)?(sqlite|fs|fs/promises|child_process|worker_threads|module|vm|process)$",
          "^(pg|pg-pool|pg-native|pg-cursor)$",
          "(^|/)node_modules/(pg|pg-pool|pg-native|pg-cursor)(/|$)",
          "/node_modules/[.]pnpm/[^/]+/node_modules/(pg|pg-pool|pg-native|pg-cursor)(/|$)",
        ],
      },
    },
    {
      name: "standalone-uses-only-public-cube-surface",
      severity: "error",
      from: { path: "^standalone/" },
      to: {
        path: "^cube/[^/]+/",
        pathNot: [
          "^cube/[^/]+/(index[.]ts|contracts/)",
          "^cube/[^/]+/[^/]+/(index[.]ts|contracts/)",
        ]
      },
    },
    ...Object.entries(frontendLayers).map(([layer, allowed]) => ({
      name: `web-${layer}-dependencies`,
      severity: "error",
      from: { path: `^web/src/${layer}/` },
      // App/main compose these layers; neither is a dependency of a lower layer.
      to: { path: "^web/src/", pathNot: `^web/src/(${allowed})/` },
    })),
    {
      name: "web-does-not-import-backend-or-tooling",
      severity: "error",
      from: { path: "^web/src/" },
      to: {
        path: "^(cube|standalone|probes|bin)/",
        pathNot: "^standalone/http/ui-routes[.]ts$",
      },
    },
    {
      name: "web-ui-routes-only-from-app",
      severity: "error",
      from: { path: "^web/src/", pathNot: "^web/src/App[.]tsx$" },
      to: { path: "^standalone/http/ui-routes[.]ts$" },
    },
    ...Object.entries(frontendLayers).map(([layer, allowed]) => ({
      name: `frontend-${layer}-dependencies`,
      severity: "error",
      from: { path: `^frontend/src/${layer}/` },
      // app/proxy compose these layers; neither is a dependency of a lower layer.
      to: { path: "^frontend/src/", pathNot: `^frontend/src/(${allowed})/` },
    })),
    {
      name: "frontend-browser-does-not-import-server",
      severity: "error",
      from: browserFrontendSource,
      to: { path: "^frontend/src/lib/server/" },
    },
    {
      name: "frontend-browser-does-not-import-node",
      severity: "error",
      from: browserFrontendSource,
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "frontend-app-does-not-import-server",
      severity: "error",
      from: { path: "^frontend/src/app/", pathNot: "/route[.]ts$" },
      to: { path: "^frontend/src/lib/server/" },
    },
    {
      name: "frontend-does-not-import-host-or-tooling",
      severity: "error",
      from: { path: "^frontend/src/" },
      to: { path: "^(cube|standalone|probes|bin|scripts|web)/|^frontend/scripts/" },
    },
    {
      name: "frontend-does-not-import-build-output",
      severity: "error",
      from: { path: "^frontend/src/" },
      to: { path: "^frontend/[.]next/" },
    },
    {
      name: "backend-does-not-import-frontend",
      severity: "error",
      from: { path: "^(cube|standalone)/" },
      to: { path: "^frontend/" },
    },
    {
      name: "web-does-not-import-frontend",
      severity: "error",
      from: { path: "^web/src/" },
      to: { path: "^frontend/" },
    },
    {
      name: "frontend-no-unresolved",
      severity: "error",
      from: { path: "^frontend/src/" },
      to: { couldNotResolve: true },
    },
    {
      name: "ui-routes-is-a-browser-leaf",
      severity: "error",
      from: { path: "^standalone/http/ui-routes[.]ts$" },
      // The UI build copies only this file from the host. Keep it self-contained.
      to: {},
    },
    {
      name: "no-circular-dependencies",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    // Keep direct edges for validation (notably the UI leaf and tooling rules),
    // but do not traverse third-party packages or fixture implementation details.
    doNotFollow: { path: "node_modules|probes/fixtures|frontend/[.]next" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
}
