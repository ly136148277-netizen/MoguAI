const DataPanel = (() => {
  const els = {};

  function init() {
    els.roots = document.getElementById("data-roots");
    els.summary = document.getElementById("data-summary");
    els.notes = document.getElementById("data-notes");
    els.error = document.getElementById("data-error");
    els.refresh = document.getElementById("data-refresh-btn");
    els.exportBtn = document.getElementById("data-export-btn");
    els.cleanupPlanBtn = document.getElementById("data-cleanup-plan-btn");
    els.cleanupRunBtn = document.getElementById("data-cleanup-run-btn");
    els.cleanupBox = document.getElementById("data-cleanup-plan");

    els.refresh?.addEventListener("click", () => refresh());
    els.exportBtn?.addEventListener("click", () => exportPack());
    els.cleanupPlanBtn?.addEventListener("click", () => planCleanup());
    els.cleanupRunBtn?.addEventListener("click", () => runCleanup());

    window.AppRouter.onPage("data", () => refresh());
  }

  async function refresh() {
    if (els.error) els.error.textContent = "";
    try {
      const scan = await window.modelManager.scanDataCenter();
      renderScan(scan);
    } catch (error) {
      if (els.error) els.error.textContent = `扫描失败：${error.message}`;
    }
  }

  function renderScan(scan) {
    if (els.summary) {
      const t = scan.tasksSummary || {};
      els.summary.textContent = `任务 ${t.total || 0} · 扫描于 ${scan.scannedAt || "—"}`;
    }
    if (els.notes) {
      els.notes.textContent = (scan.notes || []).join(" ");
    }
    if (!els.roots) return;
    const roots = scan.roots || [];
    if (!roots.length) {
      els.roots.innerHTML = `<p class="empty-state">没有可扫描路径。请先在设置中配置 PAI / 存储目录。</p>`;
      return;
    }
    els.roots.innerHTML = roots
      .map((root) => {
        const recent = (root.recentFiles || [])
          .slice(0, 3)
          .map((f) => `<li><code>${escapeHtml(f.path)}</code></li>`)
          .join("");
        return `<article class="data-root-card">
          <header>
            <strong>${escapeHtml(root.label)}</strong>
            <span class="badge">${escapeHtml(root.bytesLabel || "0 B")}</span>
          </header>
          <p class="data-root-card__path"><code>${escapeHtml(root.path || "—")}</code></p>
          <p>${root.exists ? `${root.files || 0} 个文件` : "路径不存在"}${
          root.truncated ? " · 已截断扫描" : ""
        }${root.error ? ` · ${escapeHtml(root.error)}` : ""}</p>
          ${recent ? `<ul class="data-root-card__recent">${recent}</ul>` : ""}
        </article>`;
      })
      .join("");
  }

  async function exportPack() {
    try {
      els.exportBtn && (els.exportBtn.disabled = true);
      const result = await window.modelManager.exportDiagnosticPack();
      window.AppCore?.setStatus?.(result?.ok ? `诊断包已导出：${result.path}` : "导出失败");
      if (result?.path && window.modelManager.openStoragePath) {
        // best-effort open parent
      }
    } catch (error) {
      window.AppCore?.setStatus?.(`导出失败：${error.message}`);
    } finally {
      if (els.exportBtn) els.exportBtn.disabled = false;
    }
  }

  async function planCleanup() {
    try {
      const plan = await window.modelManager.planDataCleanup();
      if (els.cleanupBox) {
        els.cleanupBox.textContent = JSON.stringify(plan, null, 2);
      }
      if (els.cleanupRunBtn) els.cleanupRunBtn.disabled = !(plan.actions || []).length;
      window.AppCore?.setStatus?.(plan.message || "已生成 dry-run 清理计划");
    } catch (error) {
      window.AppCore?.setStatus?.(`清理计划失败：${error.message}`);
    }
  }

  async function runCleanup() {
    const ok = window.confirm("确认删除 dry-run 列出的缓存/日志内容？此操作不可恢复。");
    if (!ok) return;
    try {
      const result = await window.modelManager.executeDataCleanup({ confirmToken: "CONFIRM_DELETE" });
      window.AppCore?.setStatus?.(result?.message || (result?.ok ? "已清理" : "清理失败"));
      await planCleanup();
      await refresh();
    } catch (error) {
      window.AppCore?.setStatus?.(`清理失败：${error.message}`);
    }
  }

  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  return { init, refresh };
})();

window.DataPanel = DataPanel;
