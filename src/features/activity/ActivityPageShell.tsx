import type { ReactNode } from "react";
import { AppSidebar } from "@/components/AppSidebar";
export function ActivityPageShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <main className="dashboard-shell"><AppSidebar teamScope="both" /><section className="content operations-page"><header className="page-header"><div><h1>{title}</h1><p className="page-subtitle">{description}</p></div></header>{children}</section></main>;
}
