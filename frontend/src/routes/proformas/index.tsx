import { createFileRoute } from "@tanstack/react-router"

import { ProformasView } from "../../views/ProformasView.tsx"

export const Route = createFileRoute("/proformas/")({ component: ProformasView })
