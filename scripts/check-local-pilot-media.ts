import { randomUUID } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";

import { resolveMediaScanner } from "../src/modules/family-content/media-scanner";
import { resolveConfiguredMediaRoot } from "../src/modules/family-content/private-media-store";

async function main() {
  const root = resolveConfiguredMediaRoot();
  const policy = await resolveMediaScanner().scan(Buffer.alloc(0), "image/png");
  if (policy.outcome !== "skipped") {
    throw new Error("本机图片模式仅允许非 production、显式 LOCAL_PILOT_MODE 和回环访问地址。");
  }
  await mkdir(root, { recursive: true });
  const probe = path.join(root, `.write-check-${randomUUID()}`);
  const handle = await open(probe, "wx", 0o600);
  try {
    await handle.writeFile("BrainDance media storage check");
  } finally {
    await handle.close();
    await unlink(probe);
  }
  console.log("私有图片目录可写。本机模式不进行恶意文件扫描，仍验证并重编码图片。");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "图片服务启动检查失败");
  process.exitCode = 1;
});
