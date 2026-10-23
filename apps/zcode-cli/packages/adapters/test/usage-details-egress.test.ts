import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { queryModelUsageDetails } from "../src/storage/session-store/repositories/usage-details.js";

/**
 * provider_metadata_json 是 TEXT 列；SQLite 读出来是字符串。
 * 旧实现只处理对象，字符串被当成「没有元数据」，于是库里有 accountDisplayName /
 * proxyDisplayName 时「使用详情」仍显示「未记录 / 跟随全局」。
 */
function createDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  // 与 migrations.ts 的 0010_usage_observability 保持一致：查询会读 variant 等列，
  // 用裁剪过的表会让测试以「no such column」失败而不是验证语义。
  db.exec(`
    create table model_usage (
      id text primary key,
      logical_request_id text not null,
      attempt_index integer not null default 0,
      session_id text not null,
      turn_id text,
      trace_id text,
      span_id text,
      assistant_message_id text,
      parent_user_message_id text,
      query_source text not null,
      provider_id text not null,
      model_id text not null,
      variant text,
      agent text,
      mode text,
      task_type text,
      status text not null,
      started_at integer not null,
      first_token_at integer,
      completed_at integer,
      duration_ms integer,
      time_to_first_token_ms integer,
      finish_reason text,
      tool_call_count integer not null default 0,
      input_tokens integer not null default 0,
      output_tokens integer not null default 0,
      reasoning_tokens integer not null default 0,
      cache_creation_input_tokens integer not null default 0,
      cache_read_input_tokens integer not null default 0,
      provider_total_tokens integer,
      computed_total_tokens integer not null default 0,
      retry_count integer not null default 0,
      retryable integer not null default 0,
      cancelled_by_user integer not null default 0,
      context_exceeded integer not null default 0,
      error_type text,
      error_code text,
      error_message text,
      raw_usage_json text,
      provider_metadata_json text
    );
  `);
  return db;
}

function insertUsage(db: DatabaseSync, metadata: string | null): void {
  db.prepare(
    `insert into model_usage
       (id, logical_request_id, session_id, query_source, provider_id, model_id, status, started_at, provider_metadata_json)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "usage-1",
    "req-1",
    "sess-1",
    "main_turn",
    "other:codebuddy-cn",
    "hy3",
    "completed",
    1_000,
    metadata,
  );
}

async function readRow(db: DatabaseSync) {
  const result = await queryModelUsageDetails(db, { page: 1, pageSize: 20 });
  return result.details[0];
}

describe("使用详情读取账号与出口代理", () => {
  it("从 TEXT 列的 JSON 文本里解出账号", async () => {
    const db = createDb();
    insertUsage(
      db,
      JSON.stringify({
        accountId: "99ab6e50-f737-43e4-8018-0073f2174c65",
        accountDisplayName: "17511880075",
      }),
    );

    const row = await readRow(db);

    expect(row?.accountDisplayName).toBe("17511880075");
    db.close();
  });

  it("从 TEXT 列的 JSON 文本里解出轮询代理", async () => {
    const db = createDb();
    insertUsage(
      db,
      JSON.stringify({ proxyPoolId: "pool-aws2-syd", proxyDisplayName: "轮询 5 个池" }),
    );

    const row = await readRow(db);

    expect(row?.proxyPoolId).toBe("pool-aws2-syd");
    expect(row?.proxyDisplayName).toBe("轮询 5 个池");
    db.close();
  });

  it("没有元数据时保持缺省", async () => {
    const db = createDb();
    insertUsage(db, null);

    const row = await readRow(db);

    expect(row?.accountDisplayName).toBeUndefined();
    expect(row?.proxyDisplayName).toBeUndefined();
    db.close();
  });

  it("元数据损坏时不打挂整页", async () => {
    const db = createDb();
    insertUsage(db, "{not json");

    const row = await readRow(db);

    expect(row?.providerId).toBe("other:codebuddy-cn");
    expect(row?.accountDisplayName).toBeUndefined();
    db.close();
  });
});
