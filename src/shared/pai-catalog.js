/**
 * Fallback when PAI /workflows/presets is unreachable.
 * Keep in sync with E:\projects\PAI\gateway\video_factory\routes.py (PRESET_COMMANDS + VERIFIED_WORKFLOW_PRESETS).
 */
const PRESET_COMMANDS = {
  qwen_edit: "确认千问换装",
  zimage: "确认zimage",
  ltx_i2v: "确认ltx i2v",
  video_ltx: "确认单镜头",
  ace_music: "确认ace音乐",
};

const FALLBACK_PRESETS = [
  {
    id: "qwen_edit",
    workflow: "qwen_image_edit",
    label: "千问换装",
    command: PRESET_COMMANDS.qwen_edit,
    note: "单图 history API · ~141s",
  },
  {
    id: "zimage",
    workflow: "zimage_gguf",
    label: "Z Image 出图",
    command: PRESET_COMMANDS.zimage,
    note: "~106s",
  },
  {
    id: "ltx_i2v",
    workflow: "LTX 2.3_v1.1 i2v",
    label: "LTX 变身 i2v",
    command: PRESET_COMMANDS.ltx_i2v,
    note: "~13min",
  },
  {
    id: "video_ltx",
    workflow: "video_ltx2_3_i2v",
    label: "LTX 单镜头",
    command: PRESET_COMMANDS.video_ltx,
    note: "~22min",
  },
  {
    id: "ace_music",
    workflow: "audio_ace_step",
    label: "ACE 音乐",
    command: PRESET_COMMANDS.ace_music,
    note: "~272s",
  },
];

const FALLBACK_CAPABILITIES = [
  { name: "launch_app", permission: 1, description: "打开本机软件" },
  { name: "video_factory", permission: 1, description: "ComfyUI 工作流出片" },
  { name: "comfyui_manage", permission: 2, description: "ComfyUI 队列/历史/文件" },
  { name: "backup_project", permission: 2, description: "备份项目" },
  { name: "delete_path", permission: 3, description: "删除白名单内文件" },
];

function mergePresets(remotePresets) {
  if (!Array.isArray(remotePresets) || !remotePresets.length) {
    return FALLBACK_PRESETS.map((row) => ({ ...row }));
  }
  return remotePresets.map((item) => {
    const fallback = FALLBACK_PRESETS.find((row) => row.id === item.id);
    const id = item.id || fallback?.id;
    return {
      id,
      workflow: item.workflow || fallback?.workflow || "",
      label: item.label || fallback?.label || item.workflow,
      command: item.command || PRESET_COMMANDS[id] || fallback?.command || `确认${item.label || item.workflow}`,
      note: fallback?.note || item.workflow || "",
    };
  });
}

const api = {
  PRESET_COMMANDS,
  FALLBACK_PRESETS,
  FALLBACK_CAPABILITIES,
  mergePresets,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}

if (typeof window !== "undefined") {
  window.PaiCatalog = api;
}
