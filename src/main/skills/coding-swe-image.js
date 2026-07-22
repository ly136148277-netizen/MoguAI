/**
 * Resolve official SWE-bench eval image names (matches swebench.harness TestSpec).
 * Pattern: {ns}/sweb.eval.{arch}.{instance_id.lower().replace('__','_1776_')}:{tag}
 */

function resolveSweEvalImage(instanceId, opts = {}) {
  const id = String(instanceId || "").trim();
  if (!id) return "";
  const namespace = String(opts.namespace || process.env.MOGU_SWEBENCH_NAMESPACE || "swebench").trim();
  const arch = String(opts.arch || process.env.MOGU_SWEBENCH_ARCH || "x86_64").trim();
  const tag = String(opts.tag || process.env.MOGU_SWEBENCH_IMAGE_TAG || "latest").trim();
  const key = id.toLowerCase().replace(/__/g, "_1776_");
  return `${namespace}/sweb.eval.${arch}.${key}:${tag}`;
}

module.exports = {
  resolveSweEvalImage,
};
