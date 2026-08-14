import Link from "next/link";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/AppSidebar";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import { listCustomTools } from "@/lib/data/omRequest/omCustomToolsLocalRepository";
import { getOmRequest } from "@/lib/data/omRequest/omRequestLocalRepository";
import { OmRequestForm } from "@/app/om-request/OmRequestForm";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function OmRequestEditPage({ params }: Props) {
  const session = await requireWorkspaceSession();
  const { id } = await params;
  const request = await getOmRequest(id);
  if (!request) notFound();

  const ldName = session.user?.name ?? session.user?.email?.split("@")[0] ?? "";
  const extraTools = listCustomTools();

  const {
    id: _id,
    createdAt: _createdAt,
    status: _status,
    assignedOm: _assignedOm,
    operationId: _operationId,
    ...initialData
  } = request;

  return (
    <main className="dashboard-shell">
      <AppSidebar label="담당 관리" teamScope="both" />
      <section className="content operations-page operation-create-page">
        <header className="page-header operation-create-header">
          <div>
            <div className="detail-breadcrumb">
              <Link href="/om-request/manage">담당 관리</Link>
              <span>›</span>
              <Link href={`/om-request/manage/${id}`}>{request.company} · {request.courseName}</Link>
              <span>›</span>
              <span>수정</span>
            </div>
            <h1>업무 요청 수정</h1>
          </div>
        </header>
        <OmRequestForm extraTools={extraTools} ldName={ldName} initialData={initialData} requestId={id} />
      </section>
    </main>
  );
}
