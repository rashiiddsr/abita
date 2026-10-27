import { createFileRoute } from "@tanstack/react-router";
import { ForcePasswordPage } from "../../pages/ForcePassword";

export const Route = createFileRoute("/_auth/change-password")({ component: ForcePasswordPage });
