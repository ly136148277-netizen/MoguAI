/**
 * MOGU AI 精密工厂 — Monaco 语言服务（补全/跳转）+ Node 调试 + 派工。
 */
const FactoryPanel = (() => {
  const state = {
    workspace: "",
    openPath: "",
    dirty: false,
    editor: null,
    monacoReady: false,
    fallbackEl: null,
    review: null,
    busy: false,
    activeJobId: null,
    breakpoints: new Map(), // relPath -> Map(line -> condition)
    debugUnsub: null,
    indexing: false,
    lastCallFrames: [],
  };

  const els = {};
  const CODE_EXTS = new Set(["js", "mjs", "cjs", "ts", "tsx", "jsx", "json"]);

  function languageForPath(filePath) {
    const ext = String(filePath || "")
      .split(".")
      .pop()
      ?.toLowerCase();
    const map = {
      js: "javascript",
      mjs: "javascript",
      cjs: "javascript",
      ts: "typescript",
      tsx: "typescript",
      jsx: "javascript",
      json: "json",
      md: "markdown",
      py: "python",
      html: "html",
      css: "css",
      yml: "yaml",
      yaml: "yaml",
      sh: "shell",
      ps1: "powershell",
      txt: "plaintext",
    };
    return map[ext] || "plaintext";
  }

  function joinWs(rel) {
    const ws = String(state.workspace || "").replace(/[/\\]+$/, "");
    const part = String(rel || "").replace(/^[/\\]+/, "");
    if (!ws) return part;
    return `${ws}\\${part.replace(/\//g, "\\")}`;
  }

  function toFileUri(absPath) {
    const normalized = String(absPath || "").replace(/\\/g, "/");
    if (/^[A-Za-z]:/.test(normalized)) return `file:///${normalized}`;
    return `file://${normalized}`;
  }

  function vsBaseHref() {
    const page = window.location.href.replace(/[#?].*$/, "");
    return new URL("../../node_modules/monaco-editor/min/vs/", page).href;
  }

  function setStatus(text) {
    if (els.status) els.status.textContent = text || "";
  }

  function setBusy(busy) {
    state.busy = Boolean(busy);
    if (els.runBtn) els.runBtn.disabled = busy;
    if (els.verifyBtn) els.verifyBtn.disabled = busy;
    if (els.refreshTree) els.refreshTree.disabled = busy;
    if (els.refreshReview) els.refreshReview.disabled = busy;
    if (els.pickWs) els.pickWs.disabled = busy;
    if (els.saveBtn) els.saveBtn.disabled = !state.dirty || busy;
    if (els.commitBtn) els.commitBtn.disabled = busy || !state.review?.canCommit;
    if (els.acceptAllBtn) els.acceptAllBtn.disabled = busy;
    if (els.discardAllBtn) els.discardAllBtn.disabled = busy;
    if (els.compareBtn) els.compareBtn.disabled = busy;
    els.cancelBtn?.classList.toggle("hidden", !busy || !state.activeJobId);
  }

  function autoVerifyEnabled() {
    return Boolean(els.autoVerify?.checked);
  }

  function scopeEnforceEnabled() {
    return els.scopeEnforce ? Boolean(els.scopeEnforce.checked) : true;
  }

  function scopeAllowPaths() {
    const raw = String(els.scopePaths?.value || "").trim();
    if (!raw) return undefined;
    return raw
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function setOutput(text) {
    if (els.output) els.output.textContent = String(text || "").slice(-12000) || "（无输出）";
  }

  function configureLanguageServices(monaco) {
    const js = monaco.languages.typescript.javascriptDefaults;
    const ts = monaco.languages.typescript.typescriptDefaults;
    const opts = {
      target: monaco.languages.typescript.ScriptTarget.ES2022,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      noEmit: true,
      allowJs: true,
      checkJs: true,
      jsx: monaco.languages.typescript.JsxEmit.React,
      esModuleInterop: true,
    };
    js.setCompilerOptions(opts);
    ts.setCompilerOptions({ ...opts, allowJs: true });
    js.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
    ts.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
    js.setEagerModelSync(true);
    ts.setEagerModelSync(true);
  }

  function ensureMonaco() {
    if (state.monacoReady && state.editor) return Promise.resolve(state.editor);
    if (state.fallbackEl) return Promise.resolve(null);

    return new Promise((resolve) => {
      const host = els.monaco;
      if (!host) {
        resolve(null);
        return;
      }

      const finishFallback = () => {
        host.innerHTML = "";
        const ta = document.createElement("textarea");
        ta.className = "factory-fallback-editor";
        ta.spellcheck = false;
        ta.addEventListener("input", () => {
          state.dirty = true;
          if (els.saveBtn) els.saveBtn.disabled = false;
        });
        host.appendChild(ta);
        state.fallbackEl = ta;
        setStatus("编辑器降级为文本框（Monaco 未加载）");
        resolve(null);
      };

      if (typeof window.require !== "function") {
        const loader = document.createElement("script");
        loader.src = "../../node_modules/monaco-editor/min/vs/loader.js";
        loader.onload = () => bootMonaco(resolve, finishFallback);
        loader.onerror = finishFallback;
        document.head.appendChild(loader);
        return;
      }
      bootMonaco(resolve, finishFallback);
    });
  }

  function bootMonaco(resolve, finishFallback) {
    try {
      const vs = vsBaseHref();
      const baseUrl = vs.replace(/\/vs\/?$/, "/");
      window.require.config({ paths: { vs: vs.replace(/\/$/, "") } });
      window.MonacoEnvironment = {
        getWorkerUrl(_moduleId, label) {
          let worker = `${vs}base/worker/workerMain.js`;
          if (label === "json") worker = `${vs}language/json/jsonWorker.js`;
          else if (label === "css" || label === "scss" || label === "less") {
            worker = `${vs}language/css/cssWorker.js`;
          } else if (label === "html" || label === "handlebars" || label === "razor") {
            worker = `${vs}language/html/htmlWorker.js`;
          } else if (label === "typescript" || label === "javascript") {
            worker = `${vs}language/typescript/tsWorker.js`;
          }
          const blob = new Blob(
            [
              `self.MonacoEnvironment={baseUrl:${JSON.stringify(baseUrl)}};`,
              `importScripts(${JSON.stringify(worker)});`,
            ],
            { type: "text/javascript" }
          );
          return URL.createObjectURL(blob);
        },
      };
      window.require(["vs/editor/editor.main"], () => {
        const monaco = window.monaco;
        configureLanguageServices(monaco);
        const host = els.monaco;
        host.innerHTML = "";
        state.editor = monaco.editor.create(host, {
          value: "",
          language: "plaintext",
          theme: "vs-dark",
          automaticLayout: true,
          minimap: { enabled: true },
          fontSize: 13,
          wordWrap: "on",
          quickSuggestions: true,
          suggestOnTriggerCharacters: true,
          parameterHints: { enabled: true },
          glyphMargin: true,
          lightbulb: { enabled: true },
        });
        state.editor.onDidChangeModelContent(() => {
          state.dirty = true;
          if (els.saveBtn) els.saveBtn.disabled = false;
        });
        state.editor.onMouseDown((e) => {
          if (e.target?.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
            const line = e.target.position?.lineNumber;
            const alt = Boolean(e.event?.altKey || e.event?.browserEvent?.altKey);
            const wantCond = alt || Boolean(String(els.bpCondition?.value || "").trim());
            toggleBreakpointAt(line, { withCondition: wantCond, altKey: alt });
          }
        });
        state.monacoReady = true;
        setStatus("语言服务已就绪（JS/TS 补全 · F12 跳转）");
        resolve(state.editor);
      }, finishFallback);
    } catch {
      finishFallback();
    }
  }

  function getOrCreateModel(relPath, content) {
    const monaco = window.monaco;
    if (!monaco) return null;
    const abs = joinWs(relPath);
    const uri = monaco.Uri.parse(toFileUri(abs));
    let model = monaco.editor.getModel(uri);
    const lang = languageForPath(relPath);
    if (model) {
      if (content != null && model.getValue() !== content) model.setValue(content);
      return model;
    }
    return monaco.editor.createModel(content ?? "", lang, uri);
  }

  function getEditorValue() {
    if (state.editor) return state.editor.getValue();
    if (state.fallbackEl) return state.fallbackEl.value;
    return "";
  }

  function setEditorValue(text, filePath) {
    if (state.editor && window.monaco) {
      const model = getOrCreateModel(filePath, text || "");
      state.editor.setModel(model);
      renderBreakpointGlyphs();
    } else if (state.fallbackEl) {
      state.fallbackEl.value = text || "";
    }
    state.dirty = false;
    if (els.saveBtn) els.saveBtn.disabled = true;
  }

  async function indexWorkspaceModels(entries) {
    if (!state.monacoReady || !window.monaco || state.indexing) return;
    const files = (entries || [])
      .filter((e) => e.type === "file")
      .map((e) => e.path)
      .filter((p) => CODE_EXTS.has(String(p).split(".").pop()?.toLowerCase()))
      .slice(0, 120);
    if (!files.length) return;
    state.indexing = true;
    setStatus(`索引语言服务 ${files.length} 个文件…`);
    try {
      for (const rel of files) {
        if (window.monaco.editor.getModel(window.monaco.Uri.parse(toFileUri(joinWs(rel))))) continue;
        const res = await window.modelManager.factoryRead?.({ workspace: state.workspace, path: rel });
        if (res?.ok) getOrCreateModel(rel, res.content);
      }
      setStatus(`语言索引完成（${files.length}）· Ctrl+Space 补全 · F12 跳转`);
    } finally {
      state.indexing = false;
    }
  }

  function paintTree(entries) {
    if (!els.tree) return;
    const files = (entries || []).filter((e) => e.type === "file");
    els.tree.innerHTML = files.length
      ? files
          .slice(0, 800)
          .map(
            (f) =>
              `<li><button type="button" class="factory-tree__btn" data-path="${escapeAttr(f.path)}">${escapeHtml(
                f.path
              )}</button></li>`
          )
          .join("")
      : `<li class="factory-tree__empty">无文件（或工作区为空）</li>`;
    els.tree.querySelectorAll("[data-path]").forEach((btn) => {
      btn.addEventListener("click", () => openFile(btn.dataset.path));
    });
  }

  function paintChanged(files) {
    if (!els.changed) return;
    const list = (files || []).map((f) =>
      typeof f === "string" ? { path: f, status: "?" } : { path: f?.path, status: f?.status || "?" }
    ).filter((f) => f.path);
    els.changed.innerHTML = list.length
      ? list
          .map(
            (f) =>
              `<li class="factory-changed-item">
                <button type="button" class="factory-tree__btn" data-path="${escapeAttr(f.path)}" title="打开">${escapeHtml(
                  `${f.status} ${f.path}`
                )}</button>
                <span class="factory-changed-actions">
                  <button type="button" class="btn btn--ghost btn--tiny" data-accept="${escapeAttr(f.path)}">接受</button>
                  <button type="button" class="btn btn--ghost btn--tiny" data-discard="${escapeAttr(f.path)}">拒绝</button>
                </span>
              </li>`
          )
          .join("")
      : `<li class="factory-tree__empty">暂无改动</li>`;
    els.changed.querySelectorAll("[data-path]").forEach((btn) => {
      btn.addEventListener("click", () => openFile(btn.dataset.path));
    });
    els.changed.querySelectorAll("[data-accept]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        acceptPaths([btn.dataset.accept]);
      });
    });
    els.changed.querySelectorAll("[data-discard]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        discardPaths([btn.dataset.discard]);
      });
    });
  }

  function paintHunks(list = []) {
    if (!els.hunks) return;
    const items = Array.isArray(list) ? list : [];
    els.hunks.innerHTML = items.length
      ? items
          .slice(0, 40)
          .map(
            (h) =>
              `<li class="factory-changed-item">
                <button type="button" class="factory-tree__btn" data-hunk-file="${escapeAttr(
                  h.file || ""
                )}" title="${escapeAttr(h.header || "")}">${escapeHtml(h.file || "?")} · ${escapeHtml(
                (h.header || "").slice(0, 48)
              )}</button>
                <span class="factory-changed-actions">
                  <button type="button" class="btn btn--ghost btn--tiny" data-reject-hunk="${escapeAttr(
                    h.id
                  )}">拒绝</button>
                </span>
              </li>`
          )
          .join("")
      : `<li class="factory-tree__empty">无 hunk（或非 Git）</li>`;
    els.hunks.querySelectorAll("[data-hunk-file]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.hunkFile) openFile(btn.dataset.hunkFile);
      });
    });
    els.hunks.querySelectorAll("[data-reject-hunk]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        rejectHunkId(btn.dataset.rejectHunk);
      });
    });
  }

  async function refreshHunks() {
    if (!state.workspace || !window.modelManager?.invokeSkill) {
      paintHunks([]);
      return;
    }
    const res = await window.modelManager.invokeSkill({
      skillId: "mogu.coding",
      op: "hunks",
      args: { workspace: state.workspace },
      skipPermission: true,
      skipTask: true,
    });
    paintHunks(res?.hunks || []);
  }

  async function rejectHunkId(hunkId) {
    if (!state.workspace || !hunkId) return;
    setBusy(true);
    try {
      const res = await window.modelManager.invokeSkill({
        skillId: "mogu.coding",
        op: "rejectHunk",
        args: { workspace: state.workspace, hunkId },
        skipPermission: true,
        skipTask: true,
      });
      setStatus(res?.ok ? res.message || "已拒绝 hunk" : res?.error || "拒绝失败");
      paintHunks(res?.hunks || []);
      await refreshReview();
      await refreshTree();
    } finally {
      setBusy(false);
    }
  }

  async function acceptPaths(paths = []) {
    if (!state.workspace) return;
    setBusy(true);
    setStatus(paths.length ? `接受 ${paths.length} 个文件…` : "全部接受并暂存…");
    try {
      const res = await window.modelManager.invokeSkill({
        skillId: "mogu.coding",
        op: "accept",
        args: { workspace: state.workspace, paths },
      });
      setStatus(res?.ok ? res.message || "已接受" : res?.error || "接受失败");
      await refreshReview();
    } finally {
      setBusy(false);
    }
  }

  async function discardPaths(paths = []) {
    if (!state.workspace) return;
    const label = paths.length ? `拒绝 ${paths.join(", ")}？` : "拒绝全部未提交改动？不可恢复。";
    if (!window.confirm(label)) return;
    setBusy(true);
    setStatus("拒绝改动中…");
    try {
      const res = await window.modelManager.invokeSkill({
        skillId: "mogu.coding",
        op: "discard",
        args: { workspace: state.workspace, paths },
      });
      setStatus(res?.ok ? res.message || "已拒绝" : res?.error || "拒绝失败");
      await refreshReview();
      await refreshTree();
      if (state.openPath && paths.includes(state.openPath)) {
        await openFile(state.openPath);
      }
    } finally {
      setBusy(false);
    }
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escapeAttr(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  async function refreshWorkspaceLabel() {
    if (els.wsLabel) {
      els.wsLabel.textContent = state.workspace || "工作区未设置";
      els.wsLabel.title = state.workspace || "";
    }
  }

  async function loadWorkspace() {
    const res = await window.modelManager.factoryGetWorkspace?.();
    state.workspace = res?.workspace || "";
    await refreshWorkspaceLabel();
  }

  async function pickWorkspace() {
    const res = await window.modelManager.factoryPickWorkspace?.();
    if (!res?.ok) return;
    state.workspace = res.workspace;
    await refreshWorkspaceLabel();
    await refreshTree();
    await refreshReview();
  }

  async function refreshTree() {
    if (!state.workspace) {
      paintTree([]);
      setStatus("请先选择工作区");
      return;
    }
    setStatus("加载文件树…");
    const res = await window.modelManager.factoryList?.({ workspace: state.workspace });
    if (!res?.ok) {
      setStatus(res?.error || "列出文件失败");
      paintTree([]);
      return;
    }
    paintTree(res.entries || []);
    setStatus(res.truncated ? `已加载（截断）· ${res.entries.length} 项` : `${res.entries.length} 项`);
    await ensureMonaco();
    indexWorkspaceModels(res.entries || []);
  }

  async function openFile(relPath, lineNumber) {
    if (!relPath || !state.workspace) return;
    if (state.dirty && state.openPath && state.openPath !== relPath) {
      const ok = window.confirm(`「${state.openPath}」有未保存修改，切换将丢弃。继续？`);
      if (!ok) return;
    }
    await ensureMonaco();
    const res = await window.modelManager.factoryRead?.({ workspace: state.workspace, path: relPath });
    if (!res?.ok) {
      setStatus(res?.error || "读取失败");
      return;
    }
    state.openPath = res.path;
    if (els.editorPath) els.editorPath.textContent = res.path;
    setEditorValue(res.content, res.path);
    renderBreakpointGlyphs();
    if (lineNumber && state.editor) {
      state.editor.revealLineInCenter(lineNumber);
      state.editor.setPosition({ lineNumber, column: 1 });
      state.editor.focus();
    }
    setStatus(`已打开 ${res.path}`);
  }

  async function saveFile() {
    if (!state.workspace || !state.openPath) return;
    setBusy(true);
    try {
      const res = await window.modelManager.factoryWrite?.({
        workspace: state.workspace,
        path: state.openPath,
        content: getEditorValue(),
      });
      if (!res?.ok) {
        setStatus(res?.error || "保存失败");
        return;
      }
      state.dirty = false;
      if (els.saveBtn) els.saveBtn.disabled = true;
      setStatus(`已保存 ${res.path}`);
      await refreshReview();
    } finally {
      setBusy(false);
    }
  }

  function triggerSuggest() {
    state.editor?.trigger("factory", "editor.action.triggerSuggest", {});
    setStatus("已触发补全（也可 Ctrl+Space）");
  }

  async function goToDefinition() {
    if (!state.editor || !window.monaco) {
      setStatus("编辑器未就绪");
      return;
    }
    const model = state.editor.getModel();
    const pos = state.editor.getPosition();
    if (!model || !pos) return;
    try {
      const locs =
        (await window.monaco.languages.typescript
          .getTypeScriptWorker?.()
          .then?.(async (getWorker) => {
            /* prefer editor command */
            return null;
          })
          .catch(() => null)) || null;
      void locs;
      await state.editor.getAction("editor.action.revealDefinition")?.run();
      // If definition opened another model, sync openPath from URI
      const next = state.editor.getModel();
      if (next?.uri?.fsPath || next?.uri?.path) {
        const fsPath = next.uri.fsPath || decodeURIComponent(next.uri.path.replace(/^\//, ""));
        const ws = String(state.workspace || "").replace(/\\/g, "/").toLowerCase();
        const full = String(fsPath || "").replace(/\\/g, "/");
        if (ws && full.toLowerCase().startsWith(ws)) {
          const rel = full.slice(ws.length).replace(/^[/\\]+/, "");
          state.openPath = rel;
          if (els.editorPath) els.editorPath.textContent = rel;
        }
      }
      setStatus("已跳转定义（F12）");
    } catch (error) {
      setStatus(`跳转失败：${error.message || error}`);
    }
  }

  function bpKey(rel = state.openPath) {
    return String(rel || "");
  }

  function bpMap(rel = state.openPath) {
    const key = bpKey(rel);
    if (!state.breakpoints.has(key)) state.breakpoints.set(key, new Map());
    return state.breakpoints.get(key);
  }

  function toggleBreakpointAt(lineNumber, opts = {}) {
    if (!lineNumber || !state.openPath) return;
    const map = bpMap();
    if (map.has(lineNumber) && !opts.withCondition) {
      map.delete(lineNumber);
      renderBreakpointGlyphs();
      setStatus(`断点 L${lineNumber} 已清`);
      if (window.modelManager?.factoryDebugCommand) {
        window.modelManager.factoryDebugCommand({
          command: "breakpoint",
          lineNumber,
          remove: true,
        });
      }
      return;
    }
    let condition = String(els.bpCondition?.value || "").trim();
    if (opts.altKey) {
      const typed = window.prompt(`断点条件 L${lineNumber}（留空=无条件）`, condition);
      if (typed == null) return;
      condition = String(typed).trim();
    }
    map.set(lineNumber, condition);
    renderBreakpointGlyphs();
    setStatus(
      condition
        ? `条件断点 L${lineNumber}：${condition}`
        : `断点 L${lineNumber} 已设（Alt+点槽可设条件）`
    );
    if (window.modelManager?.factoryDebugCommand) {
      window.modelManager.factoryDebugCommand({
        command: "breakpoint",
        lineNumber,
        condition,
      });
    }
  }

  function renderBreakpointGlyphs() {
    if (!state.editor || !window.monaco || !state.openPath) return;
    const map = bpMap();
    const decos = [...map.entries()].map(([line, cond]) => ({
      range: new window.monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: false,
        glyphMarginClassName: cond ? "factory-bp-glyph factory-bp-glyph--cond" : "factory-bp-glyph",
        glyphMarginHoverMessage: {
          value: cond ? `条件断点 L${line}: ${cond}` : `断点 L${line}`,
        },
      },
    }));
    if (!state._bpDecos) state._bpDecos = [];
    state._bpDecos = state.editor.deltaDecorations(state._bpDecos, decos);
  }

  function appendDebugLog(line) {
    if (!els.debugLog) return;
    els.debugLog.textContent = `${els.debugLog.textContent || ""}${line}\n`.slice(-8000);
    els.debugLog.scrollTop = els.debugLog.scrollHeight;
  }

  function paintVariables(variables) {
    if (!els.debugVars) return;
    const list = variables || [];
    els.debugVars.innerHTML = list.length
      ? list
          .map(
            (v) =>
              `<div class="factory-debug-var"><span class="factory-debug-var__name">${escapeHtml(
                v.name
              )}</span><span class="factory-debug-var__val">${escapeHtml(v.value)}</span></div>`
          )
          .join("")
      : `<div class="factory-tree__empty">暂停后显示变量</div>`;
  }

  function paintCallStack(frames) {
    if (!els.debugStack) return;
    state.lastCallFrames = frames || [];
    els.debugStack.innerHTML = state.lastCallFrames.length
      ? state.lastCallFrames
          .map(
            (f, i) =>
              `<li><button type="button" class="factory-tree__btn ${
                f.selected || i === 0 ? "is-selected" : ""
              }" data-frame="${escapeAttr(f.callFrameId || "")}" data-idx="${i}">${escapeHtml(
                `${f.functionName || "?"} :${f.lineNumber || "?"}`
              )}</button></li>`
          )
          .join("")
      : `<li class="factory-tree__empty">暂停后显示调用栈</li>`;
    els.debugStack.querySelectorAll("[data-frame]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await window.modelManager.factoryDebugCommand?.({
          command: "selectframe",
          callFrameId: btn.dataset.frame,
          index: Number(btn.dataset.idx) || 0,
        });
        const res = await window.modelManager.factoryDebugLocals?.();
        paintCallStack(res?.callFrames || state.lastCallFrames);
        paintVariables(res?.variables || []);
        const frame = res?.callFrames?.find((x) => x.selected) || res?.callFrames?.[0];
        if (frame?.lineNumber) {
          state.editor?.revealLineInCenter(frame.lineNumber);
          state.editor?.setPosition({ lineNumber: frame.lineNumber, column: 1 });
        }
      });
    });
  }

  async function refreshLocals() {
    const res = await window.modelManager.factoryDebugLocals?.();
    paintCallStack(res?.callFrames || []);
    paintVariables(res?.variables || []);
    const frame = res?.callFrames?.find((x) => x.selected) || res?.callFrames?.[0];
    if (frame?.lineNumber && state.openPath) {
      state.editor?.revealLineInCenter(frame.lineNumber);
      state.editor?.setPosition({ lineNumber: frame.lineNumber, column: 1 });
    }
  }

  async function startDebug() {
    if (!state.workspace || !state.openPath) {
      setStatus("请先打开要调试的 .js 文件");
      return;
    }
    const ext = state.openPath.split(".").pop()?.toLowerCase();
    if (!["js", "mjs", "cjs"].includes(ext)) {
      setStatus("调试目前支持 .js / .mjs / .cjs");
      return;
    }
    if (state.dirty) await saveFile();
    const map = bpMap();
    const breakpoints = [...map.entries()].map(([lineNumber, condition]) => ({
      lineNumber,
      condition: condition || undefined,
    }));
    setStatus("启动调试…");
    appendDebugLog(`> debug ${state.openPath}`);
    const res = await window.modelManager.factoryDebugStart?.({
      workspace: state.workspace,
      path: state.openPath,
      breakpoints,
    });
    if (res?.ok === false || res?.error) {
      setStatus(res?.error || "调试启动失败");
      appendDebugLog(`! ${res?.error || "fail"}`);
      return;
    }
    setStatus(`调试中 port=${res.port || "?"}（已在首行暂停）`);
    appendDebugLog(`listening :${res.port || "?"}`);
  }

  async function stopDebug() {
    await window.modelManager.factoryDebugStop?.();
    setStatus("调试已停止");
    appendDebugLog("> stopped");
    paintVariables([]);
    paintCallStack([]);
  }

  async function runFactorySearch() {
    const q = String(els.searchInput?.value || "").trim();
    if (!state.workspace) {
      setStatus("请先选择工作区");
      return;
    }
    if (!q) {
      if (els.searchHits) els.searchHits.innerHTML = "";
      return;
    }
    setStatus(`搜索「${q}」…`);
    const res = await window.modelManager.factorySearch?.({
      workspace: state.workspace,
      query: q,
    });
    if (!els.searchHits) return;
    const hits = res?.hits || [];
    els.searchHits.innerHTML = hits.length
      ? hits
          .map(
            (h) =>
              `<li><button type="button" class="factory-tree__btn" data-path="${escapeAttr(
                h.path
              )}" data-line="${h.line || ""}">${escapeHtml(h.path)}${
                h.line ? `:${h.line}` : ""
              }${
                h.preview && h.kind === "symbol"
                  ? `<div class="factory-hit-line">${escapeHtml(h.preview)}</div>`
                  : ""
              }</button></li>`
          )
          .join("")
      : `<li class="factory-tree__empty">无结果</li>`;
    els.searchHits.querySelectorAll("[data-path]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const line = Number(btn.dataset.line) || null;
        openFile(btn.dataset.path, line);
      });
    });
    setStatus(res?.ok === false ? res.error || "搜索失败" : `找到 ${hits.length} 条`);
  }

  async function debugCmd(command) {
    const res = await window.modelManager.factoryDebugCommand?.({ command });
    if (res?.ok === false) setStatus(res.error || "调试命令失败");
    if (command === "continue" || command.startsWith("step")) {
      setTimeout(() => refreshLocals(), 200);
    }
  }

  function bindDebugEvents() {
    state.debugUnsub?.();
    state.debugUnsub = window.modelManager.onFactoryDebugEvent?.((evt) => {
      if (!evt) return;
      if (evt.kind === "console") appendDebugLog(`[${evt.level}] ${evt.text}`);
      if (evt.kind === "exception") appendDebugLog(`! ${evt.text}`);
      if (evt.kind === "paused") {
        setStatus(`已暂停 ${evt.callFrames?.[0]?.functionName || ""} L${evt.callFrames?.[0]?.lineNumber || "?"}`);
        appendDebugLog(`paused L${evt.callFrames?.[0]?.lineNumber || "?"}`);
        paintCallStack((evt.callFrames || []).map((f, i) => ({ ...f, selected: i === 0 })));
        const frame = evt.callFrames?.[0];
        if (frame?.url && state.workspace) {
          const ws = state.workspace.replace(/\\/g, "/").toLowerCase();
          let urlPath = String(frame.url || "").replace(/^file:\/\//, "").replace(/^\/([A-Za-z]:)/, "$1");
          urlPath = decodeURIComponent(urlPath).replace(/\\/g, "/");
          if (urlPath.toLowerCase().startsWith(ws)) {
            const rel = urlPath.slice(ws.length).replace(/^[/\\]+/, "");
            openFile(rel, frame.lineNumber);
          } else if (state.openPath && frame.lineNumber) {
            state.editor?.revealLineInCenter(frame.lineNumber);
            state.editor?.setPosition({ lineNumber: frame.lineNumber, column: 1 });
          }
        }
        refreshLocals();
      }
      if (evt.kind === "resumed") setStatus("运行中…");
      if (evt.kind === "terminated" || evt.kind === "stopped") {
        setStatus("调试结束");
        paintVariables([]);
        paintCallStack([]);
      }
    });
  }

  async function refreshReview() {
    if (!state.workspace || !window.modelManager?.invokeSkill) {
      paintChanged([]);
      if (els.diff) els.diff.textContent = "";
      return;
    }
    const res = await window.modelManager.invokeSkill({
      skillId: "mogu.coding",
      op: "review",
      args: { workspace: state.workspace },
      skipPermission: true,
      skipTask: true,
    });
    state.review = res;
    paintChanged(res?.files || []);
    if (els.diff) els.diff.textContent = res?.diff || res?.summary || "（无 diff）";
    if (els.commitMsg && res?.suggestedCommitMessage && !els.commitMsg.value) {
      els.commitMsg.value = res.suggestedCommitMessage;
    }
    if (els.commitBtn) els.commitBtn.disabled = !res?.canCommit || state.busy;
    await refreshHunks();
  }

  function showFactoryInstallCta(show) {
    els.installBtn?.classList.toggle("hidden", !show);
  }

  async function installEngineFromFactory() {
    setBusy(true);
    setStatus("正在安装编程引擎适配版…");
    const unsub = window.modelManager.onCodingRuntimeProgress?.((evt) => {
      if (evt?.message) setStatus(evt.message);
    });
    try {
      const res = await window.modelManager.codingRuntimeUpgrade?.({ engine: "all" });
      if (res?.ok) {
        showFactoryInstallCta(false);
        setStatus("引擎已安装，可再点派工人");
      } else {
        showFactoryInstallCta(true);
        setStatus(res?.error || "安装失败，请到设置重试");
      }
    } catch (error) {
      showFactoryInstallCta(true);
      setStatus(`安装异常：${error.message}`);
    } finally {
      if (typeof unsub === "function") unsub();
      setBusy(false);
    }
  }

  async function ensureEngineReady() {
    try {
      const pf = await window.modelManager.invokeSkill({
        skillId: "mogu.coding",
        op: "preflight",
        args: { workspace: state.workspace, requireWorkspace: false },
      });
      const missing = pf?.canInstallRuntime || pf?.issues?.some((i) => i.code === "engine_missing");
      showFactoryInstallCta(Boolean(missing));
      if (missing) {
        setStatus(pf?.ctaMessage || "引擎未就绪，可点「安装引擎」");
        return false;
      }
      return true;
    } catch {
      return true;
    }
  }

  async function cancelDispatch() {
    const id = state.activeJobId;
    if (!id) {
      setStatus("当前没有进行中的派工");
      return;
    }
    setStatus("正在取消…");
    try {
      const res = await window.modelManager.invokeSkill({
        skillId: "mogu.coding",
        op: "cancel",
        args: { moguTaskId: id },
      });
      setStatus(res?.ok ? "已取消派工" : res?.error || "取消失败");
      setOutput(res?.ok ? `已取消任务 ${id}` : res?.error || "取消失败");
    } catch (error) {
      setStatus(`取消异常：${error.message}`);
    }
  }

  function formatDispatchResult(res, { compare = false } = {}) {
    const lines = [];
    if (compare) {
      lines.push(
        res?.ok === false
          ? `对比失败：${res.error || ""}`
          : `对比完成 · 胜者 ${res?.winner === "moguai_b" ? "引擎B" : "引擎A"}`
      );
      if (res?.scores) {
        lines.push(`得分 A=${res.scores.moguai_a ?? "?"} B=${res.scores.moguai_b ?? "?"}`);
      }
    } else {
      lines.push(res?.ok === false ? `失败：${res.error || ""}` : "派工完成");
    }
    if (res?.quality?.warning) lines.push(`质量：${res.quality.warning}`);
    if (res?.rounds?.length) {
      lines.push(
        `轮次 ${res.rounds.length} · 验证 ${
          res.verifyOk === true ? "通过" : res.verifyOk === false ? "失败" : "跳过"
        }`
      );
    }
    if (res?.projectRules?.length) lines.push(`规则：${res.projectRules.join(", ")}`);
    if (res?.editPlan?.locationReason) lines.push(`定位：${res.editPlan.locationReason}`);
    if (res?.editPlan?.targetPaths?.length) {
      lines.push(
        `目标：${res.editPlan.targetPaths.slice(0, 8).join(", ")}${
          res.editPlan.targetPaths.length > 8 ? "…" : ""
        }`
      );
    }
    if (res?.editPlan?.mustTouch?.length) {
      lines.push(`要点：${res.editPlan.mustTouch.slice(0, 8).join("、")}`);
    }
    if (res?.scope?.locked && res.scope.allowedPaths?.length) {
      lines.push(`锁定：${res.scope.allowedPaths.slice(0, 10).join(", ")}`);
    } else if (res?.scope?.reason) {
      lines.push(`范围：${res.scope.reason}`);
    }
    if (res?.scope?.enforcement?.trimmed?.length) {
      lines.push(`已回滚越界：${res.scope.enforcement.trimmed.join(", ")}`);
    }
    if (res?.content?.warning) lines.push(`内容：${res.content.warning}`);
    if (res?.hint) lines.push(res.hint);
    const log = String(res?.log || "").trim();
    if (log) lines.push(`---\n${log}`);
    return lines.filter(Boolean).join("\n");
  }

  async function runDispatch({ compare = false } = {}) {
    const prompt = String(els.prompt?.value || "").trim();
    if (!prompt) {
      setStatus("请输入派工说明");
      return;
    }
    if (!state.workspace) {
      setStatus("请先选择工作区");
      return;
    }
    const jobId = `factory-${Date.now()}`;
    state.activeJobId = jobId;
    setBusy(true);
    setStatus(compare ? "双引擎对比中…可点取消" : "工人执行中…可点取消");
    setOutput(compare ? "对比进行中…\n" : "派工进行中…\n");
    try {
      const ready = await ensureEngineReady();
      if (!ready) return;
      const res = await window.modelManager.invokeSkill({
        skillId: "mogu.coding",
        op: compare ? "compare" : "dispatch",
        args: {
          workspace: state.workspace,
          prompt,
          moguTaskId: jobId,
          autoVerify: autoVerifyEnabled(),
          scopeEnforce: scopeEnforceEnabled(),
          scopeMode: scopeEnforceEnabled() ? "trim" : "off",
          allowPaths: scopeAllowPaths(),
          compare: compare || undefined,
          maxFixRounds: 3,
        },
      });
      if (res?.permissionDenied) {
        setStatus(res.error || "权限已拒绝");
        setOutput(res.error || "权限已拒绝");
        return;
      }
      if (res?.ok === false && (res.canInstallRuntime || res.code === "engine_missing")) {
        showFactoryInstallCta(true);
        setStatus(res.ctaMessage || res.error || "引擎未就绪");
        setOutput(res.ctaMessage || res.error || "");
        return;
      }
      showFactoryInstallCta(false);
      setOutput(formatDispatchResult(res, { compare }));
      const qualityHint = res?.quality?.warning ? ` · ${res.quality.warning}` : "";
      setStatus(
        res?.ok === false
          ? `${(res.error || (compare ? "对比失败" : "派工失败")).split("\n")[0]} · 可再派或手改`
          : compare
            ? `对比完成 · 已应用胜者改动 · 可按 hunk 微调${qualityHint}`
            : `派工完成 · 可按文件/hunk 接受拒绝${qualityHint}`
      );
      if (res?.suggestedCommitMessage && els.commitMsg) els.commitMsg.value = res.suggestedCommitMessage;
      if (res?.hunks) paintHunks(res.hunks);
      await refreshReview();
      await refreshTree();
    } finally {
      state.activeJobId = null;
      setBusy(false);
    }
  }

  async function commitChanges() {
    if (!state.workspace) return;
    const message = String(els.commitMsg?.value || "").trim() || "chore: factory commit";
    setBusy(true);
    setStatus("提交中…");
    try {
      const res = await window.modelManager.invokeSkill({
        skillId: "mogu.coding",
        op: "commit",
        args: { workspace: state.workspace, message },
      });
      setStatus(res?.ok ? `已提交 ${res.commit || ""}` : res?.error || "提交失败");
      await refreshReview();
    } finally {
      setBusy(false);
    }
  }

  async function verifyWorkspace() {
    if (!state.workspace) return;
    setBusy(true);
    setStatus("跑测试中…");
    setOutput("测试进行中…\n");
    try {
      const res = await window.modelManager.invokeSkill({
        skillId: "mogu.coding",
        op: "verify",
        args: { workspace: state.workspace },
      });
      const body = [`$ ${res?.command || "npm test"}`, res?.log || "", res?.error || ""]
        .filter(Boolean)
        .join("\n");
      setOutput(body || "（无输出）");
      setStatus(res?.ok ? "测试通过" : `测试失败：${res?.error || ""}`);
    } finally {
      setBusy(false);
    }
  }

  async function openWithOptions(options = {}) {
    if (options.workspace) {
      state.workspace = options.workspace;
      await refreshWorkspaceLabel();
    } else {
      await loadWorkspace();
    }
    if (options.prompt) {
      const input = els.prompt || document.getElementById("factory-prompt");
      if (input) input.value = String(options.prompt);
    }
    await ensureMonaco();
    await refreshTree();
    await refreshReview();
    const focusFile = options.focusFile || options.files?.[0];
    if (focusFile) await openFile(focusFile);
    await ensureEngineReady();
  }

  function bind() {
    els.wsLabel = document.getElementById("factory-workspace-label");
    els.pickWs = document.getElementById("factory-pick-workspace");
    els.refreshTree = document.getElementById("factory-refresh-tree");
    els.saveBtn = document.getElementById("factory-save-btn");
    els.refreshReview = document.getElementById("factory-refresh-review");
    els.verifyBtn = document.getElementById("factory-verify-btn");
    els.commitBtn = document.getElementById("factory-commit-btn");
    els.acceptAllBtn = document.getElementById("factory-accept-all-btn");
    els.discardAllBtn = document.getElementById("factory-discard-all-btn");
    els.prompt = document.getElementById("factory-prompt");
    els.runBtn = document.getElementById("factory-run-btn");
    els.compareBtn = document.getElementById("factory-compare-btn");
    els.autoVerify = document.getElementById("factory-auto-verify");
    els.scopeEnforce = document.getElementById("factory-scope-enforce");
    els.scopePaths = document.getElementById("factory-scope-paths");
    els.cancelBtn = document.getElementById("factory-cancel-btn");
    els.installBtn = document.getElementById("factory-install-engine-btn");
    els.status = document.getElementById("factory-status");
    els.output = document.getElementById("factory-output");
    els.tree = document.getElementById("factory-file-tree");
    els.changed = document.getElementById("factory-changed-files");
    els.hunks = document.getElementById("factory-hunks");
    els.commitMsg = document.getElementById("factory-commit-msg");
    els.editorPath = document.getElementById("factory-editor-path");
    els.monaco = document.getElementById("factory-monaco");
    els.diff = document.getElementById("factory-diff");
    els.suggestBtn = document.getElementById("factory-suggest-btn");
    els.gotoBtn = document.getElementById("factory-goto-btn");
    els.debugStartBtn = document.getElementById("factory-debug-start");
    els.debugStopBtn = document.getElementById("factory-debug-stop");
    els.debugContinueBtn = document.getElementById("factory-debug-continue");
    els.debugStepOverBtn = document.getElementById("factory-debug-stepover");
    els.debugStepIntoBtn = document.getElementById("factory-debug-stepinto");
    els.debugStepOutBtn = document.getElementById("factory-debug-stepout");
    els.debugLog = document.getElementById("factory-debug-log");
    els.debugVars = document.getElementById("factory-debug-vars");
    els.debugStack = document.getElementById("factory-debug-stack");
    els.bpCondition = document.getElementById("factory-bp-condition");
    els.searchInput = document.getElementById("factory-search-input");
    els.searchBtn = document.getElementById("factory-search-btn");
    els.searchHits = document.getElementById("factory-search-hits");

    els.pickWs?.addEventListener("click", () => pickWorkspace());
    els.refreshTree?.addEventListener("click", () => refreshTree());
    els.saveBtn?.addEventListener("click", () => saveFile());
    els.refreshReview?.addEventListener("click", () => refreshReview());
    els.verifyBtn?.addEventListener("click", () => verifyWorkspace());
    els.commitBtn?.addEventListener("click", () => commitChanges());
    els.runBtn?.addEventListener("click", () => runDispatch());
    els.compareBtn?.addEventListener("click", () => runDispatch({ compare: true }));
    els.cancelBtn?.addEventListener("click", () => cancelDispatch());
    els.acceptAllBtn?.addEventListener("click", () => acceptPaths([]));
    els.discardAllBtn?.addEventListener("click", () => discardPaths([]));
    els.installBtn?.addEventListener("click", () => installEngineFromFactory());
    els.suggestBtn?.addEventListener("click", () => triggerSuggest());
    els.gotoBtn?.addEventListener("click", () => goToDefinition());
    els.debugStartBtn?.addEventListener("click", () => startDebug());
    els.debugStopBtn?.addEventListener("click", () => stopDebug());
    els.debugContinueBtn?.addEventListener("click", () => debugCmd("continue"));
    els.debugStepOverBtn?.addEventListener("click", () => debugCmd("stepover"));
    els.debugStepIntoBtn?.addEventListener("click", () => debugCmd("stepinto"));
    els.debugStepOutBtn?.addEventListener("click", () => debugCmd("stepout"));
    els.searchBtn?.addEventListener("click", () => runFactorySearch());
    els.searchInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runFactorySearch();
    });
    els.prompt?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runDispatch();
    });
    bindDebugEvents();
  }

  function init() {
    bind();
    if (typeof AppRouter !== "undefined") {
      AppRouter.onPage("factory", (options) => {
        openWithOptions(options || {});
      });
    }
  }

  return { init, openWithOptions };
})();

document.addEventListener("DOMContentLoaded", () => {
  FactoryPanel.init();
});
