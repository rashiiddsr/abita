import { APP_GROUPS, AppGrid, useApps } from "../components/apps";
import { SubPage } from "../components/shell";
import { Card, SectionLabel } from "../components/ui";

export function AppsPage() {
  const apps = useApps();
  return (
    <SubPage title="Semua menu">
      {APP_GROUPS.map((g) => (
        <div key={g.title}>
          <SectionLabel>{g.title}</SectionLabel>
          <Card pad={false} className="px-2 py-3.5">
            <AppGrid ids={g.apps} onOpen={apps.open} />
          </Card>
        </div>
      ))}
      {apps.sheets}
    </SubPage>
  );
}
