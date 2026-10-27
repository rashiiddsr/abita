import { createFileRoute } from "@tanstack/react-router";
import { NotificationDetailPage } from "../../../pages/NotificationDetail";

export const Route = createFileRoute("/_auth/notifications/$id")({ component: Detail });

function Detail() {
  const { id } = Route.useParams();
  return <NotificationDetailPage id={Number(id)} />;
}
