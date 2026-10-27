import { createFileRoute } from "@tanstack/react-router";
import { ForgotPage } from "../pages/Forgot";

export const Route = createFileRoute("/forgot-password")({ component: ForgotPage });
