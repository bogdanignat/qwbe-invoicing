const frontendLayers = {
  lib: "lib",
  hooks: "lib|hooks",
  components: "lib|hooks|components",
  views: "lib|hooks|components|views",
  routes: "lib|hooks|components|views|routes",
}

// Everything under frontend/src ships to the browser: the layers, routes/, the
// entrypoint (main.tsx) and the generated route tree. Only the node:test files
// next to the code run in Node.
const browserFrontendSource = {
  path: "^frontend/src/",
  pathNot: "[.](test|spec|test-support)[.][cm]?[jt]sx?$",
}

module.exports = {
  forbidden: [
    {
      name: "cube-does-not-import-host-or-tooling",
      severity: "error",
      from: { path: "^cubes/" },
      to: { path: "^(kernel|probes)/" },
    },
    {
      name: "cube-does-not-touch-runtime-infrastructure",
      severity: "error",
      from: { path: "^cubes/" },
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
      name: "kernel-uses-only-public-cube-surface",
      severity: "error",
      from: { path: "^kernel/" },
      to: {
        path: "^cubes/[^/]+/",
        pathNot: [
          "^cubes/[^/]+/(index[.]ts|contracts/)",
          "^cubes/[^/]+/[^/]+/(index[.]ts|contracts/)",
        ]
      },
    },
    ...Object.entries(frontendLayers).map(([layer, allowed]) => ({
      name: `frontend-${layer}-dependencies`,
      severity: "error",
      from: { path: `^frontend/src/${layer}/` },
      // The entrypoint and the generated route tree compose these layers; neither
      // is a dependency of a layer, and no layer below routes/ reaches a route.
      to: { path: "^frontend/src/", pathNot: `^frontend/src/(${allowed})/` },
    })),
    {
      // The server side of the frontend is the Vite dev/build server: its config,
      // the build scripts and the build-time packages. None of it runs in a page.
      name: "frontend-browser-does-not-import-server",
      severity: "error",
      from: browserFrontendSource,
      to: {
        path: [
          "^frontend/[^/]+[.][cm]?[jt]sx?$",
          "^frontend/scripts/",
          "(^|/)node_modules/(vite|@vitejs/[^/]+|@tailwindcss/vite|@tanstack/router-plugin|@tanstack/router-generator)(/|$)",
        ],
      },
    },
    {
      name: "frontend-browser-does-not-import-node",
      severity: "error",
      from: browserFrontendSource,
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "frontend-does-not-import-host-or-tooling",
      severity: "error",
      from: { path: "^frontend/src/" },
      to: { path: "^(cubes|kernel|probes|bin|scripts)/|^frontend/scripts/" },
    },
    {
      name: "frontend-does-not-import-build-output",
      severity: "error",
      from: { path: "^frontend/src/" },
      to: { path: "^frontend/dist/" },
    },
    {
      name: "backend-does-not-import-frontend",
      severity: "error",
      from: { path: "^(cubes|kernel)/" },
      to: { path: "^frontend/" },
    },
    {
      name: "frontend-no-unresolved",
      severity: "error",
      from: { path: "^frontend/src/" },
      to: { couldNotResolve: true },
    },
    {
      name: "no-circular-dependencies",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    // Keep direct edges for validation (notably the tooling rules),
    // but do not traverse third-party packages or fixture implementation details.
    doNotFollow: { path: "node_modules|probes/fixtures|frontend/dist" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
}
