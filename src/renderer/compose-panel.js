const ComposePanel = (() => {
  const els = {};
  let pipeline = {};
  /** @type {{ path: string, name: string, url?: string }[]} */
  let timeline = [];
  let busy = false;
  let lastOutputPath = "";

  function init() {
    els.tool = document.getElementById("compose-tool");
    els.removeToolBtn = document.getElementById("compose-remove-tool-btn");
    els.concatBtn = document.getElementById("compose-concat-btn");
    els.openToolBtn = document.getElementById("compose-open-tool-btn");
    els.track = document.getElementById("compose-timeline-track");
    els.result = document.getElementById("compose-result");
    els.resultVideo = document.getElementById("compose-result-video");
    els.resultPath = document.getElementById("compose-result-path");
    els.resultOpenBtn = document.getElementById("compose-result-open-btn");

    els.tool?.addEventListener("change", onToolChange);
    els.removeToolBtn?.addEventListener("click", removeCustomTool);
    els.concatBtn?.addEventListener("click", runConcat);
    els.openToolBtn?.addEventListener("click", openInTool);
    els.resultOpenBtn?.addEventListener("click", openResultInTool);
    els.track?.addEventListener("click", onTrackClick);

    if (window.modelManager?.onComposeProgress) {
      window.modelManager.onComposeProgress((payload) => {
        if (payload?.message) {
          window.AppCore?.setStatus?.(payload.message);
        }
      });
    }

    window.AppRouter.onPage("compose", onEnter);
  }

  async function onEnter() {
    pipeline = (await window.modelManager.getStudioPipeline()) || {};
    fillToolSelect(pipeline.tool || "shotcut");
    renderTimeline();
  }

  function setBusy(next) {
    busy = Boolean(next);
    if (els.concatBtn) els.concatBtn.disabled = busy;
    if (els.openToolBtn) els.openToolBtn.disabled = busy;
  }

  async function runConcat() {
    if (busy) return;
    if (timeline.length < 2) {
      window.alert("请至少加入 2 段视频再拼接");
      return;
    }
    setBusy(true);
    window.AppCore?.setStatus?.("准备拼接…");
    try {
      const result = await window.modelManager.concatComposeVideos({
        paths: timeline.map((c) => c.path),
      });
      if (!result?.ok) {
        hideResult();
        window.alert(result?.error || result?.message || "拼接失败");
        window.AppCore?.setStatus?.(result?.error || "拼接失败");
        return;
      }
      await showResult(result.path);
      window.AppCore?.setStatus?.("拼接完成");
    } catch (error) {
      hideResult();
      window.alert(`拼接失败：${error.message}`);
      window.AppCore?.setStatus?.(`拼接失败：${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  function hideResult() {
    lastOutputPath = "";
    els.result?.classList.add("hidden");
    if (els.resultVideo) {
      els.resultVideo.removeAttribute("src");
      els.resultVideo.load?.();
    }
    if (els.resultPath) els.resultPath.textContent = "";
  }

  async function showResult(filePath) {
    lastOutputPath = String(filePath || "");
    if (!lastOutputPath || !els.result) return;
    els.result.classList.remove("hidden");
    if (els.resultPath) els.resultPath.textContent = lastOutputPath;
    try {
      const media = await window.modelManager.getStudioMediaUrl(lastOutputPath);
      if (els.resultVideo && media?.ok && media.url) {
        els.resultVideo.src = media.url;
        els.resultVideo.load?.();
      }
    } catch {
      /* preview optional */
    }
    els.result.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }

  async function openResultInTool() {
    if (!lastOutputPath) return;
    try {
      await persistTool();
      await window.modelManager.openComposeTool({
        tool: els.tool?.value || "shotcut",
        path: lastOutputPath,
      });
    } catch (error) {
      window.alert(`打开工具失败：${error.message}`);
    }
  }

  async function openInTool() {
    try {
      await persistTool();
      const mediaPath = lastOutputPath || timeline[0]?.path || "";
      if (!mediaPath) {
        window.alert("请先在时间线加入视频，或完成一次拼接");
        return;
      }
      await window.modelManager.openComposeTool({
        tool: els.tool?.value || "shotcut",
        path: mediaPath,
      });
    } catch (error) {
      window.alert(`打开工具失败：${error.message}`);
    }
  }

  function builtinToolOptions() {
    return [
      { value: "shotcut", label: "Shotcut（免费剪辑）" },
      { value: "jianying", label: "剪映" },
    ];
  }

  function fillToolSelect(selected) {
    if (!els.tool) return;
    const customs = Array.isArray(pipeline.customTools) ? pipeline.customTools : [];
    const options = [
      ...builtinToolOptions(),
      ...customs.map((t) => ({
        value: `custom:${t.id}`,
        label: `${t.name}（自定义）`,
      })),
      { value: "__add__", label: "添加其它工具…" },
    ];
    let current = selected || pipeline.tool || "shotcut";
    if (current === "none" || current === "ffmpeg" || current === "__add__") {
      current = "shotcut";
    }
    els.tool.innerHTML = options
      .map((opt) => `<option value="${opt.value}">${opt.label}</option>`)
      .join("");
    const values = options.map((o) => o.value);
    els.tool.value = values.includes(current) ? current : "shotcut";
    updateRemoveToolVisibility();
  }

  function updateRemoveToolVisibility() {
    const isCustom = String(els.tool?.value || "").startsWith("custom:");
    els.removeToolBtn?.classList.toggle("hidden", !isCustom);
  }

  async function persistTool() {
    pipeline = {
      ...pipeline,
      tool: els.tool?.value || "shotcut",
    };
    await window.modelManager.saveStudioPipeline(pipeline);
  }

  async function onToolChange() {
    if (els.tool?.value === "__add__") {
      const prev =
        pipeline.tool && pipeline.tool !== "__add__" ? pipeline.tool : "shotcut";
      els.tool.value =
        ["shotcut", "jianying"].includes(prev) || String(prev).startsWith("custom:")
          ? prev
          : "shotcut";
      await addCustomTool();
      return;
    }
    await persistTool();
    updateRemoveToolVisibility();
  }

  async function addCustomTool() {
    try {
      const result = await window.modelManager.addStudioCustomTool();
      if (!result || result.cancelled) return;
      pipeline = result.pipeline || (await window.modelManager.getStudioPipeline()) || pipeline;
      fillToolSelect(result.tool ? `custom:${result.tool.id}` : pipeline.tool);
    } catch (error) {
      window.alert(`添加工具失败：${error.message}`);
    }
  }

  async function removeCustomTool() {
    const value = String(els.tool?.value || "");
    if (!value.startsWith("custom:")) return;
    const id = value.slice("custom:".length);
    const name = (pipeline.customTools || []).find((t) => t.id === id)?.name || "该工具";
    if (!window.confirm(`从列表移除「${name}」？\n不会卸载电脑上的软件。`)) return;
    try {
      const result = await window.modelManager.removeStudioCustomTool(id);
      pipeline = result.pipeline || (await window.modelManager.getStudioPipeline()) || pipeline;
      fillToolSelect(pipeline.tool || "shotcut");
    } catch (error) {
      window.alert(`移除失败：${error.message}`);
    }
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function basename(filePath) {
    const parts = String(filePath || "").split(/[/\\]/);
    return parts[parts.length - 1] || filePath;
  }

  function renderPlus(index) {
    return `<button type="button" class="compose-tl-plus" data-action="add" data-index="${index}" title="选择视频加入时间线">+</button>`;
  }

  function renderClipBlock(clip, index) {
    const src = clip.url ? escapeHtml(clip.url) : "";
    return `
      <div class="compose-tl-clip" data-index="${index}" data-path="${escapeHtml(clip.path)}" title="${escapeHtml(clip.path)}">
        <div class="compose-tl-clip__head">
          <span>${escapeHtml(clip.name)}</span>
          <button type="button" class="compose-tl-clip__remove" data-action="remove" data-index="${index}" title="移出时间线">×</button>
        </div>
        <div class="compose-tl-clip__body">
          <video
            class="compose-tl-clip__video"
            muted
            playsinline
            preload="metadata"
            ${src ? `src="${src}"` : ""}
          ></video>
          <div class="compose-tl-clip__placeholder${src ? " is-hidden" : ""}">加载预览…</div>
        </div>
      </div>
    `;
  }

  function renderTimeline() {
    if (!els.track) return;
    const parts = [];
    parts.push(renderPlus(0));
    timeline.forEach((clip, index) => {
      parts.push(renderClipBlock(clip, index));
      parts.push(renderPlus(index + 1));
    });
    if (!timeline.length) {
      parts.push(`<p class="compose-tl-empty">时间线为空，点「+」选择视频加入</p>`);
    }
    els.track.innerHTML = parts.join("");
    hydrateTimelinePreviews();
  }

  async function resolveMediaUrl(filePath) {
    if (!filePath || !window.modelManager?.getStudioMediaUrl) return "";
    try {
      const media = await window.modelManager.getStudioMediaUrl(filePath);
      return media?.ok ? media.url : "";
    } catch {
      return "";
    }
  }

  async function hydrateTimelinePreviews() {
    if (!els.track) return;
    const cards = [...els.track.querySelectorAll(".compose-tl-clip")];
    await Promise.all(
      cards.map(async (card) => {
        const index = Number(card.getAttribute("data-index"));
        const clip = timeline[index];
        if (!clip) return;
        const video = card.querySelector(".compose-tl-clip__video");
        const placeholder = card.querySelector(".compose-tl-clip__placeholder");
        if (!video) return;

        if (!clip.url) {
          clip.url = await resolveMediaUrl(clip.path);
        }
        if (!clip.url) {
          if (placeholder) {
            placeholder.textContent = "无法预览";
            placeholder.classList.remove("is-hidden");
          }
          return;
        }

        const showFrame = () => {
          try {
            if (Number.isFinite(video.duration) && video.duration > 0.2) {
              video.currentTime = Math.min(0.2, video.duration * 0.1);
            }
          } catch {
            /* ignore */
          }
          placeholder?.classList.add("is-hidden");
        };

        video.onloadeddata = showFrame;
        video.onerror = () => {
          if (placeholder) {
            placeholder.textContent = "预览失败";
            placeholder.classList.remove("is-hidden");
          }
        };
        if (video.src !== clip.url) {
          video.src = clip.url;
          video.load?.();
        } else if (video.readyState >= 2) {
          showFrame();
        }
      })
    );
  }

  function addToTimeline(filePath, insertAt) {
    const path = String(filePath || "").trim();
    if (!path) return false;
    if (timeline.some((c) => c.path === path)) {
      return false;
    }
    const item = { path, name: basename(path) };
    if (Number.isInteger(insertAt) && insertAt >= 0 && insertAt <= timeline.length) {
      timeline.splice(insertAt, 0, item);
    } else {
      timeline.push(item);
    }
    return true;
  }

  async function pickAndAdd(insertAt = timeline.length) {
    try {
      const result = await window.modelManager.pickComposeMedia();
      if (!result || result.cancelled || !result.paths?.length) return;
      let added = 0;
      let cursor = Number.isInteger(insertAt) ? insertAt : timeline.length;
      for (const filePath of result.paths) {
        if (addToTimeline(filePath, cursor)) {
          added += 1;
          cursor += 1;
        }
      }
      renderTimeline();
      if (!added) {
        window.alert("所选视频已在时间线上");
      }
    } catch (error) {
      window.alert(`添加失败：${error.message}`);
    }
  }

  async function onTrackClick(event) {
    const btn = event.target?.closest?.("[data-action]");
    if (!btn || !els.track.contains(btn)) return;
    const action = btn.getAttribute("data-action");
    if (action === "add") {
      const index = Number(btn.getAttribute("data-index"));
      await pickAndAdd(Number.isInteger(index) ? index : timeline.length);
      return;
    }
    if (action === "remove") {
      const index = Number(btn.getAttribute("data-index"));
      if (Number.isInteger(index) && index >= 0 && index < timeline.length) {
        timeline.splice(index, 1);
        renderTimeline();
      }
    }
  }

  return { init };
})();

window.ComposePanel = ComposePanel;
