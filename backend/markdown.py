from markdown import markdown
import bleach

ALLOWED_TAGS = [
    "p", "br", "hr", "strong", "em", "del", "code", "pre",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "blockquote", "a",
    "table", "thead", "tbody", "tr", "th", "td",
]
ALLOWED_ATTRIBUTES = {
    "a": ["href", "title", "target", "rel"],
}
ALLOWED_PROTOCOLS = ["http", "https", "mailto"]


def render_markdown(markdown_text: str) -> str:
    html = markdown(
        markdown_text,
        extensions=["fenced_code", "tables", "sane_lists"],
        output_format="html5",
    )
    return bleach.clean(
        html,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        protocols=ALLOWED_PROTOCOLS,
        strip=True,
    )
