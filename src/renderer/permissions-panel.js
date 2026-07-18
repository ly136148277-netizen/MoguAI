const PermissionsPanel = (() => {
  const els = {};

  function init() {
    els.grants = document.getElementById("perm-grants");
    els.audit = document.getElementById("perm-audit");
    els.status = document.getElementById("perm-status");
    els.refresh = document.getElementById("perm-refresh-btn");
    els.refresh?.addEventListener("click", () => refresh());
    window.AppRouter.onPage("permissions", () => refresh());
  }

  async function refresh() {
    try {
      const grantsRes = await window.modelManager.listPermissionGrants?.();
      const auditRes = await window.modelManager.listPermissionAudit?.({ limit: 40 });
      paintGrants(grantsRes?.grants || []);
      if (els.audit) {
        els.audit.textContent = (auditRes?.entries || [])
          .map(
            (e) =>
              `${e.ts || e.createdAt || ""}  L${e.riskLevel}  ${e.allowed ? "ALLOW" : "DENY"}  ${e.tool}  ${e.reason || ""}  ${String(e.action || "").slice(0, 80)}`
          )
          .join("\n");
      }
      if (els.status) {
        els.status.textContent = `授权 ${(grantsRes?.grants || []).length} · 审计 ${(auditRes?.entries || []).length} 条`;
      }
    } catch (error) {
      if (els.status) els.status.textContent = error.message;
    }
  }

  function paintGrants(grants) {
    if (!els.grants) return;
    if (!grants.length) {
      els.grants.innerHTML = `<p class="empty-state">暂无记住的授权。批准 L2 操作后会出现在这里。</p>`;
      return;
    }
    els.grants.innerHTML = grants
      .map(
        (g) => `<article class="skills-card">
          <div class="skills-card__head">
            <strong>${escapeHtml(g.tool)}</strong>
            <span class="badge">≤ L${escapeHtml(String(g.maxRiskLevel))}</span>
            <button type="button" class="btn btn--danger btn--tiny" data-revoke="${escapeHtml(g.id)}">撤销</button>
          </div>
          <p class="settings-section-hint">${escapeHtml(g.action || "")}</p>
          <p class="settings-section-hint">更新于 ${escapeHtml(g.updatedAt || g.createdAt || "—")}</p>
        </article>`
      )
      .join("");
    els.grants.querySelectorAll("[data-revoke]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await window.modelManager.revokePermissionGrant({ grantId: btn.getAttribute("data-revoke") });
        await refresh();
      });
    });
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

window.PermissionsPanel = PermissionsPanel;
