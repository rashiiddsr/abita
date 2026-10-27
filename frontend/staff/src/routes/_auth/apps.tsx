import { createFileRoute } from "@tanstack/react-router";
import { AppsPage } from "../../pages/Apps";

export const Route = createFileRoute("/_auth/apps")({ component: AppsPage });
