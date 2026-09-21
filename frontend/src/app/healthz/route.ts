import "server-only"

const health = (): Response => new Response('{"status":"live"}\n', {
  status: 200,
  headers: {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  },
})

export const GET = health
export const HEAD = (): Response => new Response(null, { status: 200, headers: {
  "cache-control": "no-store", "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff",
} })
