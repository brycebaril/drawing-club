import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * SecurityDocument.md §8: CMS/session-note content is authored by a
 * privileged-but-not-fully-trusted user and rendered to other users — a
 * stored-XSS surface. react-markdown renders straight to React elements
 * (no dangerouslySetInnerHTML) and treats raw HTML embedded in the markdown
 * source as literal text rather than interpreting it, as long as the
 * rehype-raw plugin is never added here. Do not add it.
 */
export function Markdown({ content }: { content: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>;
}
