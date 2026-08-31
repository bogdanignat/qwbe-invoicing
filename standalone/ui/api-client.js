export class ApiError extends Error {
  constructor(status, payload) {
    const issues = Array.isArray(payload?.issues) ? payload.issues.filter((item) => typeof item === "string") : []
    const code = typeof payload?.code === "string" ? payload.code : undefined
    super(issues[0] ?? code ?? (status === 401 ? "Sesiunea locală nu este autorizată." : "Cererea nu a putut fi finalizată."))
    this.name = "ApiError"
    this.status = status
    this.issues = issues
    this.code = code
  }
}

export const createApiClient = ({ fetchImplementation = globalThis.fetch, onUnauthorized = () => {} } = {}) => {
  let token

  const setToken = (value) => {
    token = typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
  }

  const request = async (path, { method = "GET", body, responseType = "json" } = {}) => {
    if (token === undefined) throw new ApiError(401, { error: "AuthenticationRequired" })
    const headers = { accept: responseType === "blob" ? "application/pdf" : "application/json", authorization: `Bearer ${token}` }
    if (body !== undefined) headers["content-type"] = "application/json"
    const response = await fetchImplementation(path, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (response.status === 401) {
      setToken("")
      onUnauthorized()
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new ApiError(response.status, payload)
    }
    if (responseType === "blob") return response.blob()
    return response.json()
  }

  return { setToken, request }
}
