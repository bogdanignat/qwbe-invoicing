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
    {
      name: "no-circular-dependencies",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "node_modules|probes/fixtures" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
}
