import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = ["b", "strong", "u", "a", "span", "br", "div", "p"];

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: { a: ["href", "target", "rel"], span: ["style"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowedStyles: {
    span: {
      color: [/^#[0-9a-f]{3,6}$/i, /^rgb\(\s*\d{1,3},\s*\d{1,3},\s*\d{1,3}\s*\)$/]
    }
  },
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" })
  }
};

export function sanitizeAnnouncementContent(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

export function announcementContentToPlainText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, "").trim();
}
