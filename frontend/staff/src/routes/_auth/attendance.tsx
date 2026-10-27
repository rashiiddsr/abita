import { createFileRoute } from "@tanstack/react-router";
import { PresensiPage } from "../../pages/Presensi";

export const Route = createFileRoute("/_auth/attendance")({ component: PresensiPage });
