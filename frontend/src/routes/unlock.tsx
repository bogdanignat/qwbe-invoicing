import { createFileRoute } from "@tanstack/react-router"

import { UnlockView } from "../views/UnlockView.tsx"

export const Route = createFileRoute("/unlock")({ component: UnlockView })
