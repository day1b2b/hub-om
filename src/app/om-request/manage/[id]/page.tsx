import Link from "next/link";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/AppSidebar";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { getOmRequest } from "@/lib/data/omRequest/omRequestLocalRepository";
import { AssignForm } from "./AssignForm";
import { OmRequestDetailView } from "./OmRequestDetailView";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function OmRequestDetailPage({ params }: Props) {
  await requireWorkspaceSession();
  const { id } = await params;
  const request = getOmRequest(id);
  if (!request) notFound();

  const createdAt = new Date(request.createdAt).toLocaleString("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  });

  return (
    <main className="dashboard-shell">
      <AppSidebar label="OM 배정 관리" teamScope="both" />
      <section className="content operations-page">

        <header className="page-header">
          <div>
            <div className="detail-breadcrumb">
              <Link href="/om-request/manage">배정 관리</Link>
              <span>›</span>
            </div>
            <h1>{request.courseName}</h1>
            <p className="page-subtitle">{request.company} · {request.team} · 접수 {createdAt}</p>
          </div>
        </header>

        <div className="detail-layout">
          <OmRequestDetailView request={request} />

          <aside className="detail-sidebar">
            <div className="detail-card">
              <h2>
                OM 배정
                <span className={`om-status-badge ${request.status === "배정필요" ? "need" : "done"}`} style={{ fontSize: 11 }}>
                  {request.status}
                </span>
              </h2>
              <AssignForm request={request} />
            </div>
          </aside>
        </div>

      </section>
    </main>
  );
}
