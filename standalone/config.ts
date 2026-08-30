export interface RuntimeConfig {
  readonly host: string
  readonly port: number
  readonly dataDirectory: string
  readonly nodeEnvironment: string
  readonly authTokenFile: string | undefined
  readonly organizationId: string | undefined
}

const positivePort = (value: string | undefined): number => {
  const parsed = Number(value ?? "3000")
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535")
  }
  return parsed
}

export const runtimeConfig = (environment: NodeJS.ProcessEnv = process.env): RuntimeConfig => ({
  host: environment.HOST ?? "0.0.0.0",
  port: positivePort(environment.PORT),
  dataDirectory: environment.DATA_DIR ?? "/data",
  nodeEnvironment: environment.NODE_ENV ?? "development",
  authTokenFile: environment.AUTH_TOKEN_FILE,
  organizationId: environment.ORGANIZATION_ID,
})
