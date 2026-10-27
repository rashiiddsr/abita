import { createFileRoute } from "@tanstack/react-router";
import { DocumentFolderPage } from "../../../pages/Documents";

export const Route = createFileRoute("/_auth/documents/$id")({ component: Folder });

function Folder() {
  const { id } = Route.useParams();
  return <DocumentFolderPage id={Number(id)} />;
}
