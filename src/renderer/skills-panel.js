const SkillsPanel = (() => {
  const els = {};

  function init() {
    els.list = document.getElementById("skills-list");
    els.env = document.getElementById("skills-env");
    els.doc = document.getElementById("skills-doc");
    els.status = document.getElementById("skills-status");
    els.refresh = document.getElementById("skills-refresh-btn");
    els.sync = document.getElementById("skills-sync-docs-btn");

    els.refresh?.addEventListener("click", () => refresh());
    els.sync?.addEventListener("click", () => syncDocs());
    window.AppRouter.onPage("skills", () => refresh());
  }

  async function refresh() {
    try {
      const data = await window.modelManager.listSkills();
      paintEnv(data.env || {});
      paintList(data.skills || []);
      if (els.status) {
        els.status.textContent = `Skills 根目录：${data.skillsRoot || "—"}`;
      }
    } catch (error) {
      if (els.status) els.status.textContent = error.message;
    }
  }

  function paintEnv(env) {
    if (!els.env) return;
    const chips = [
      ["PAI", env.pai],
      ["ComfyUI", env.comfyui],
      ["Ollama", env.ollama || env.ollamaInstalled],
      ["FFmpeg", env.ffmpeg],
    ];
    els.env.innerHTML = chips
      .map(
        ([label, ok]) =>
          `<span class="home-env-chip${ok ? "" : " home-env-chip--warn"}">${label} ${ok ? "就绪" : "未就绪"}</span>`
      )
      .join("");
  }

  function paintList(skills) {
    if (!els.list) return;
    els.list.innerHTML = skills
      .map((skill) => {
        const checked = skill.enabled !== false ? "checked" : "";
        const lamp = skill.envOk ? "就绪" : "缺环境";
        return `<article class="skills-card" data-skill="${escapeHtml(skill.id)}">
          <div class="skills-card__head">
            <strong>${escapeHtml(skill.title || skill.id)}</strong>
            <span class="badge">${escapeHtml(lamp)}</span>
            <label class="checkbox-row skills-card__toggle">
              <input type="checkbox" data-skill-toggle="${escapeHtml(skill.id)}" ${checked} />
              启用
            </label>
          </div>
          <p class="settings-section-hint">${escapeHtml(skill.summary || "")}</p>
          <p class="settings-section-hint">风险默认 L${escapeHtml(String(skill.riskDefault ?? 2))} · ${escapeHtml((skill.ops || []).join(", "))}</p>
          <button type="button" class="btn btn--ghost btn--tiny" data-skill-doc="${escapeHtml(skill.id)}">查看说明</button>
          <button type="button" class="btn btn--ghost btn--tiny" data-skill-preflight="${escapeHtml(skill.id)}">预检</button>
        </article>`;
      })
      .join("");

    els.list.querySelectorAll("[data-skill-toggle]").forEach((input) => {
      input.addEventListener("change", async () => {
        const id = input.getAttribute("data-skill-toggle");
        await window.modelManager.setSkillEnabled({ skillId: id, enabled: input.checked });
        await refresh();
      });
    });
    els.list.querySelectorAll("[data-skill-doc]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-skill-doc");
        const doc = await window.modelManager.getSkillDoc({ skillId: id });
        if (els.doc) els.doc.textContent = doc.markdown || doc.error || "";
      });
    });
    els.list.querySelectorAll("[data-skill-preflight]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-skill-preflight");
        const result = await window.modelManager.preflightSkill({ skillId: id, args: {} });
        if (els.doc) els.doc.textContent = JSON.stringify(result, null, 2);
      });
    });
  }

  async function syncDocs() {
    try {
      const result = await window.modelManager.syncOpenclawSkillDocs();
      if (els.status) {
        els.status.textContent = result.ok
          ? `已同步 ${((result.copied || []).length)} 个 SKILL.md → ${result.destRoot}`
          : result.error || "同步失败";
      }
    } catch (error) {
      if (els.status) els.status.textContent = error.message;
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

window.SkillsPanel = SkillsPanel;
