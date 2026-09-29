from duckduckgo_search import DDGS


def web_search(query: str, max_results: int = 3) -> str:
    try:
        results = []
        with DDGS() as ddgs:
            for result in ddgs.text(query, max_results=max_results):
                results.append(
                    f"Title: {result['title']}\nSnippet: {result['body']}\nURL: {result['href']}"
                )
        return "\n\n".join(results) if results else "No relevant search results found."
    except Exception as exc:
        return f"Search error: {exc}"
