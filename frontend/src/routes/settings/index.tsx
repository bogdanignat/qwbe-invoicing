import { createFileRoute } from "@tanstack/react-router"

import { SettingsView } from "../../views/SettingsView.tsx"

export const Route = createFileRoute("/settings/")({ component: SettingsView })
