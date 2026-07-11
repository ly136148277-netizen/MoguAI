const MIRROR_PRESETS = {
  official: {
    label: "官方源",
    transform: (url) => url,
  },
  hf_mirror: {
    label: "HF Mirror",
    transform: (url) =>
      url.replace("https://huggingface.co", "https://hf-mirror.com"),
  },
  modelscope: {
    label: "ModelScope",
    transform: (url) => url,
  },
  github: {
    label: "GitHub Release",
    transform: (url) => url,
  },
  custom: {
    label: "自定义 URL",
    transform: (url) => url,
  },
};

const ALLOWED_THREADS = [1, 2, 4, 8];
const ALLOWED_CONCURRENT = [1, 2, 4, 8];

function resolveDownloadUrl(model, mirrorKey = "official", customUrl = "") {
  if (mirrorKey === "custom") {
    if (customUrl && customUrl.trim()) {
      return customUrl.trim();
    }
    if (model.sources?.custom) {
      return model.sources.custom;
    }
    throw new Error("自定义镜像 URL 未配置");
  }

  if (model.sources?.[mirrorKey]) {
    return model.sources[mirrorKey];
  }

  const preset = MIRROR_PRESETS[mirrorKey];
  if (!preset) {
    return model.url;
  }

  if (mirrorKey === "modelscope" || mirrorKey === "github") {
    return model.url;
  }

  return preset.transform(model.url);
}

function listMirrorOptions() {
  return Object.entries(MIRROR_PRESETS).map(([key, value]) => ({
    key,
    label: value.label,
  }));
}

module.exports = {
  MIRROR_PRESETS,
  ALLOWED_THREADS,
  ALLOWED_CONCURRENT,
  resolveDownloadUrl,
  listMirrorOptions,
};
