const TasksPanel = (() => {
  const els = {};
  let unsub = null;
  let selectedId = null;
  let loading = false;

  function init() {
    els.list = document.getElementById("tasks-list");
    els.empty = document.getElementById("tasks-empty");
    els.error = document.getElementById("tasks-error");
    els.source = document.getElementById("tasks-filter-source");
    els.status = document.getElementById("tasks-filter-status");
    els.query = document.getElementById("tasks-filter-query");
    els.refresh = document.getElementById("tasks-refresh-btn");
    els.detail = document.getElementById("tasks-detail");
    els.cancelBtn = document.getElementById("tasks-cancel-btn");
    els.retryBtn = document.getElementById("tasks-retry-btn");

    els.refresh?.addEventListener("click", () => refresh());
    els.source?.addEventListener("change", () => refresh());
    els.status?.addEventListener("change", () => refresh());
    els.query?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        refresh();
      }
    });
    els.cancelBtn?.addEventListener("click", () => cancelSelected());
    els.retryBtn?.addEventListener("click", () => retrySelected());

    if (window.modelManager?.onTaskChange) {
      unsub = window.modelManager.onTaskChange(() => {
        refresh({ silent: true });
      });
    }

    window.AppRouter.onPage("tasks", () => refresh());
  }

  function filters() {
    const source = els.source?.value || "";
    const status = els.status?.value || "";
    return {
      sources: source ? [source] : undefined,
      statuses: status ? [status] : undefined,
      query: els.query?.value?.trim() || undefined,
      limit: 100,
    };
  }

  async function refresh(options = {}) {
    if (!els.list || loading) return;
    loading = true;
    if (!options.silent && els.error) els.error.textContent = "";
    try {
      const page = await window.modelManager.listTasks(filters());
      const tasks = page?.tasks || [];
      renderList(tasks);
      if (selectedId) {
        const hit = tasks.find((t) => t.moguTaskId === selectedId);
        if (hit) renderDetail(hit);
        else if (page?.ok !== false) {
          const one = await window.modelManager.getTask(selectedId);
          if (one?.task) renderDetail(one.task);
        }
      } else if (!tasks.length) {
        renderDetail(null);
      }
    } catch (error) {
      if (els.error) els.error.textContent = `加载失败：${error.message}`;
      if (els.list) els.list.innerHTML = "";
      els.empty?.classList.remove("hidden");
    } finally {
      loading = false;
    }
  }

  function renderList(tasks) {
    if (!els.list) return;
    if (!tasks.length) {
      els.list.innerHTML = "";
      els.empty?.classList.remove("hidden");
      return;
    }
    els.empty?.classList.add("hidden");
    els.list.innerHTML = tasks
      .map((task) => {
        const active = task.moguTaskId === selectedId ? " is-active" : "";
        return `<button type="button" class="queue-item tasks-item${active}" data-task-id="${escapeHtml(
          task.moguTaskId
        )}">
          <div class="queue-item__meta">
            <strong>${escapeHtml(task.name || task.moguTaskId)}</strong>
            <span class="badge">${escapeHtml(task.status || "—")}</span>
            <span>${escapeHtml(task.source || "—")}</span>
          </div>
          <div class="tasks-item__ids">${escapeHtml(task.moguTaskId)} · ${escapeHtml(
          task.runId || task.promptId || task.taskId || "无外部 ID"
        )}</div>
        </button>`;
      })
      .join("");

    els.list.querySelectorAll("[data-task-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        selectedId = btn.dataset.taskId;
        await refresh({ silent: true });
      });
    });
  }

  function renderDetail(task) {
    if (!els.detail) return;
    if (!task) {
      els.detail.innerHTML = `<p class="empty-state">选择左侧任务查看终态、日志与输出路径。</p>`;
      els.cancelBtn && (els.cancelBtn.disabled = true);
      els.retryBtn && (els.retryBtn.disabled = true);
      return;
    }
    const terminal = ["succeeded", "failed", "cancelled", "timed_out"].includes(task.status);
    els.cancelBtn && (els.cancelBtn.disabled = terminal);
    els.retryBtn && (els.retryBtn.disabled = !terminal || !task.replay);
    const outputs = (task.outputPaths || []).map((p) => `<li><code>${escapeHtml(p)}</code></li>`).join("") || "<li>—</li>";
    els.detail.innerHTML = `
      <h3>${escapeHtml(task.name || "任务详情")}</h3>
      <dl class="tasks-detail__grid">
        <dt>moguTaskId</dt><dd><code>${escapeHtml(task.moguTaskId)}</code></dd>
        <dt>来源</dt><dd>${escapeHtml(task.source || "—")}</dd>
        <dt>状态</dt><dd><span class="badge">${escapeHtml(task.status || "—")}</span></dd>
        <dt>sessionKey</dt><dd><code>${escapeHtml(task.sessionKey || "—")}</code></dd>
        <dt>runId</dt><dd><code>${escapeHtml(task.runId || "—")}</code></dd>
        <dt>taskId</dt><dd><code>${escapeHtml(task.taskId || "—")}</code></dd>
        <dt>prompt_id</dt><dd><code>${escapeHtml(task.promptId || "—")}</code></dd>
        <dt>更新时间</dt><dd>${escapeHtml(task.updatedAt || "—")}</dd>
        <dt>错误</dt><dd>${escapeHtml(task.errorMessage || "—")}</dd>
      </dl>
      <h4>日志摘要</h4>
      <pre class="tasks-detail__log">${escapeHtml(task.logSummary || "—")}</pre>
      <h4>输出路径</h4>
      <ul>${outputs}</ul>
    `;
  }

  async function cancelSelected() {
    if (!selectedId) return;
    try {
      const result = await window.modelManager.cancelTask({ moguTaskId: selectedId });
      if (result?.needsConfirmation) {
        window.AppCore?.setStatus?.(result.message || "缺少精确 ID，无法安全取消");
        return;
      }
      window.AppCore?.setStatus?.(result?.ok ? "已取消任务" : result?.error || "取消失败");
      await refresh();
    } catch (error) {
      window.AppCore?.setStatus?.(`取消失败：${error.message}`);
    }
  }

  async function retrySelected() {
    if (!selectedId) return;
    try {
      const result = await window.modelManager.retryTask({ moguTaskId: selectedId });
      if (!result?.ok) {
        window.AppCore?.setStatus?.(result?.message || "无法重试");
        return;
      }
      selectedId = result.task?.moguTaskId || selectedId;
      window.AppCore?.setStatus?.("已创建重试任务（需执行引擎接手）");
      await refresh();
    } catch (error) {
      window.AppCore?.setStatus?.(`重试失败：${error.message}`);
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

window.TasksPanel = TasksPanel;
