import { createFileRoute } from "@tanstack/react-router";
import { AccountPage } from "../../pages/Account";

export const Route = createFileRoute("/_auth/account")({ component: AccountPage });
