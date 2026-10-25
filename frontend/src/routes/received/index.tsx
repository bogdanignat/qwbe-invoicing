import { createFileRoute } from "@tanstack/react-router"

import { ReceivedView } from "../../views/ReceivedView.tsx"

export const Route = createFileRoute("/received/")({ component: ReceivedView })
