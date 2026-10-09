import "server-only"

import { runtimeProxyConfig } from "../../../../lib/server/config.ts"
import { handleApiDocsRequest } from "../../../../lib/server/proxy-docs.ts"

export const GET = (request: Request): Promise<Response> => handleApiDocsRequest(request, runtimeProxyConfig())
