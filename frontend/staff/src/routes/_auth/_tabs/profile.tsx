import { createFileRoute } from "@tanstack/react-router";
import { ProfilePage } from "../../../pages/Profile";

export const Route = createFileRoute("/_auth/_tabs/profile")({ component: ProfilePage });
