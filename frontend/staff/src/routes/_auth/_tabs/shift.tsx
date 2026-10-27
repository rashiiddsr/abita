import { createFileRoute } from "@tanstack/react-router";
import { ShiftPage } from "../../../pages/Shift";

export const Route = createFileRoute("/_auth/_tabs/shift")({ component: ShiftPage });
