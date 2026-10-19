import { createFileRoute } from "@tanstack/react-router"

import { ProformaAuthoringView } from "../../views/ProformaAuthoringView.tsx"

export const Route = createFileRoute("/proformas/new")({ component: ProformaAuthoringView })
