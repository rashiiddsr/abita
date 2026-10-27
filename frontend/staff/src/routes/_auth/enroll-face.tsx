import { createFileRoute } from "@tanstack/react-router";
import { EnrollPage } from "../../pages/Enroll";

export const Route = createFileRoute("/_auth/enroll-face")({ component: () => <EnrollPage /> });
