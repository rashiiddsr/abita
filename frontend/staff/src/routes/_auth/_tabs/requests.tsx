import { createFileRoute } from "@tanstack/react-router";
import { RequestsPage } from "../../../pages/Requests";

export const Route = createFileRoute("/_auth/_tabs/requests")({ component: RequestsPage });
