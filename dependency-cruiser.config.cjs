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
      to: { path: "^(node:)?(sqlite|fs|fs/promises|child_process|worker_threads|module|vm|process)$" },
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
