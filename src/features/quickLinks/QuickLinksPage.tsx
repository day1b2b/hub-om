import { AppSidebar } from "@/components/AppSidebar";
import type { TeamScope } from "@/lib/teamScope";

interface QuickLinkGroup {
  links: { href: string; icon: string; label: string }[];
  title: string;
}

const QUICK_LINK_GROUPS: QuickLinkGroup[] = [
  {
    title: "문서함",
    links: [
      { href: "https://drive.google.com/drive/folders/12_HUpNnff9O3VcVQFYxN_qTOGkq-NDCR", icon: "📁", label: "[ENT] AX컨설팅 파트 드라이브" },
      { href: "https://drive.google.com/drive/folders/1dgYfV5I6RZdOo5s1BYnU6IbIg1sxQ62q", icon: "📁", label: "[ENT] AX컨설팅 파트 OM 드라이브" }
    ]
  },
  {
    // 예시 항목. 나중에 기능별 세부 그룹으로 나뉠 수 있음 — 실제 시트 목록은 이어서 반영.
    title: "시트",
    links: [
      { href: "https://docs.google.com/spreadsheets/d/REPLACE_ME_운영현황시트", icon: "📊", label: "운영 현황 시트 (예시)" },
      { href: "https://docs.google.com/spreadsheets/d/REPLACE_ME_만족도조사시트", icon: "📊", label: "만족도 조사 시트 (예시)" }
    ]
  }
];

interface QuickLinksPageProps {
  teamScope: TeamScope;
}

export function QuickLinksPage({ teamScope }: QuickLinksPageProps) {
  return (
    <main className="dashboard-shell">
      <AppSidebar label="주요링크모음" teamScope={teamScope} />

      <section className="content quick-links-page">
        <header className="page-header">
          <div>
            <p className="eyebrow">공지/운영TOOL</p>
            <h1>주요링크모음</h1>
            <p className="lede">자주 접근하는 문서함·시트 링크를 모아둔 1차 초안입니다. 시트는 예시이며, 실제 목록은 이어서 반영합니다.</p>
          </div>
        </header>

        {QUICK_LINK_GROUPS.map((group) => (
          <div className="quick-link-group" key={group.title}>
            <h2>{group.title}</h2>
            <div className="quick-link-grid">
              {group.links.map((link) => (
                <a
                  className="quick-link-card"
                  data-icon={link.icon}
                  href={link.href}
                  key={link.href}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
