import { once } from "node:events"

export const frontendOrigin = "https://invoicing-proxy.example.test"

export const listen = async (server) => {
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  return `http://127.0.0.1:${String(address.port)}`
}

export const close = async (server) => {
  if (server.listening) await new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)))
}

export const proxyRequest = (path, init = {}) => new globalThis.Request(`${frontendOrigin}/api/qwbe/${path}`, {
  ...init, headers: { host: "invoicing-proxy.example.test", ...(init.headers ?? {}) },
})
