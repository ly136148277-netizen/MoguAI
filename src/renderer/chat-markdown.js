function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function highlightCode(code, language) {
  const escaped = escapeHtml(code);
  if (!language) {
    return escaped;
  }
  return `<span class="code-lang">${escapeHtml(language)}</span>${escaped}`;
}

function renderMarkdown(content) {
  if (!content) {
    return "";
  }

  const placeholders = [];
  let text = String(content);

  text = text.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const index = placeholders.length;
    placeholders.push(
      `<pre class="md-code-block"><div class="md-code-head"><span>${escapeHtml(lang || "code")}</span><button type="button" class="copy-code-btn" data-copy="${encodeURIComponent(code.trim())}">复制</button></div><code>${highlightCode(code.trim(), lang)}</code></pre>`
    );
    return `@@CODE_BLOCK_${index}@@`;
  });

  text = escapeHtml(text);
  text = text.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  text = text.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  text = text.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*(.+?)\*/g, "<em>$1</em>");
  text = text.replace(/`([^`]+)`/g, "<code class=\"md-inline-code\">$1</code>");
  text = text.replace(/^\s*[-*] (.+)$/gm, "<li>$1</li>");
  text = text.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");
  text = text.replace(/\n{2,}/g, "</p><p>");
  text = `<p>${text}</p>`;
  text = text.replace(/<p><\/p>/g, "");
  text = text.replace(/@@CODE_BLOCK_(\d+)@@/g, (_match, index) => placeholders[Number(index)] || "");

  return text;
}

window.ChatMarkdown = { renderMarkdown, escapeHtml };
