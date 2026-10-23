import { homedir } from "node:os";
import { join } from "node:path";

/**
 * 会话库默认路径：`{数据基目录}/.xcode/cli/db/db.sqlite`。
 *
 * 数据基目录取 `XCODE_DATA_BASE_DIR`（缺省 homedir），与服务层的
 * `getDataBaseDir()` 语义一致。此处不能硬编码 homedir——否则 dev 用隔离数据目录时，
 * agent 仍把会话库写进用户主目录，与正式版互相污染，两边的 usage 明细混在一起。
 */
export function getDefaultSessionDbPath(): string {
  const baseDir = process.env.XCODE_DATA_BASE_DIR?.trim() || homedir();
  return join(baseDir, ".xcode", "cli", "db", "db.sqlite");
}
