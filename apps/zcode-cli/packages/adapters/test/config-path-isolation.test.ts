import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolvePath } from "../src/config/file-config.adapter.js";

const ENV_KEYS = ["XCODE_DATA_BASE_DIR", "XCODE_DESKTOP_HOME_DIR", "HOME"] as const;

describe("resolvePath 的 ~ 展开", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("默认展开到真实家目录", () => {
    for (const key of ENV_KEYS) delete process.env[key];

    expect(resolvePath("~/.xcode/cli/db/db.sqlite")).toBe(
      join(homedir(), ".xcode/cli/db/db.sqlite"),
    );
  });

  it("XCODE_DATA_BASE_DIR 生效时降到隔离数据目录", () => {
    delete process.env.XCODE_DESKTOP_HOME_DIR;
    delete process.env.HOME;
    process.env.XCODE_DATA_BASE_DIR = "D:/xcode-deva";

    // 这是 dev 会话库写回正式库的回归点：storage.sessionDbPath 的默认值就是 ~/.xcode/cli/db/db.sqlite。
    expect(resolvePath("~/.xcode/cli/db/db.sqlite")).toBe(
      join(resolve("D:/xcode-deva"), ".xcode/cli/db/db.sqlite"),
    );
  });

  it("只有 XCODE_DESKTOP_HOME_DIR 时同样隔离", () => {
    delete process.env.XCODE_DATA_BASE_DIR;
    delete process.env.HOME;
    process.env.XCODE_DESKTOP_HOME_DIR = "D:/xcode-deva";

    expect(resolvePath("~/.xcode/cli")).toBe(join(resolve("D:/xcode-deva"), ".xcode/cli"));
  });

  it("XCODE_DATA_BASE_DIR 优先于 XCODE_DESKTOP_HOME_DIR", () => {
    process.env.XCODE_DATA_BASE_DIR = "D:/data-root";
    process.env.XCODE_DESKTOP_HOME_DIR = "D:/home-root";

    expect(resolvePath("~/.xcode/cli")).toBe(join(resolve("D:/data-root"), ".xcode/cli"));
  });

  it("绝对路径不受数据基目录影响", () => {
    process.env.XCODE_DATA_BASE_DIR = "D:/xcode-deva";

    expect(resolvePath("E:/other/place.json")).toBe(resolve("E:/other/place.json"));
  });

  it("非 .xcode 的 ~ 路径仍落在真实家目录", () => {
    delete process.env.HOME;
    process.env.XCODE_DATA_BASE_DIR = "D:/xcode-deva";

    // ~ 的通用语义不能被数据目录隔离改写：用户显式配置 ~/my-data 必须在自己的 home 下。
    expect(resolvePath("~/my-data/notes.json")).toBe(join(homedir(), "my-data/notes.json"));
  });

  it("~/ 后面形似 .xcode 但不是该目录时不走隔离", () => {
    delete process.env.HOME;
    process.env.XCODE_DATA_BASE_DIR = "D:/xcode-deva";

    expect(resolvePath("~/.xcode-backup/db.sqlite")).toBe(
      join(homedir(), ".xcode-backup/db.sqlite"),
    );
  });
});
