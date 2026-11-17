import { posix } from "node:path";

export const REMOTE_AGENT_OFFICIAL_PLUGIN_DIR_NAME = "packages";

export const REMOTE_AGENT_OFFICIAL_PLUGIN_PACKAGE_NAMES = [
  "android-emulator-plugin",
  "browser-use-plugin",
  "zcode-cua-plugin",
  "documents-plugin",
  "pdf-plugin",
  "presentations-plugin",
  "spreadsheets-plugin",
  "image-search-plugin",
  "ios-simulator-plugin",
  "restore-legacy-sessions-plugin",
  "skill-creator-plugin",
  "plugin-creator-plugin",
  "zcode-guide-plugin",
  "visualize-plugin",
  "zcode-site-plugin",
] as const;

export const REMOTE_AGENT_OFFICIAL_PLUGIN_INCLUDED_TOP_LEVEL_PATHS = [
  ".mcp.json",
  ".zcode-plugin",
  "README.md",
  // 开发态远程插件复制使用独立白名单，遗漏 agents 会只在远端丢失子代理。
  "agents",
  "commands",
  "dist",
  "docs",
  "hooks",
  "output-styles",
  "package.json",
  // Browser bootstrap 会从插件根目录动态导入 scripts/browser-client.mjs。
  // 开发态 SSH 部署若漏掉 scripts，会出现 MCP server 已启动但浏览器绑定无法初始化的半成品状态。
  "scripts",
  "skills",
  "templates",
] as const;

export const REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS = [
  // 工作流技能已迁出插件；远端复用仍必须检查这份 Agent 必需资产。
  "bundled-skills/skills/dynamic-workflows/SKILL.md",
  "bundled-skills/skills/dynamic-workflows/patterns.md",
  "bundled-skills/skills/dynamic-workflows/examples.md",
  // 越狱技能随 CLI 内置：远端主机上缺失 SKILL.md 时，小玉拿不到可调用的越狱技能。
  "bundled-skills/skills/xcode-godmode/SKILL.md",
  // fork 测试入口：远端主机没有本机 fork 时脚本会明确报错，而不是静默少一个测试项。
  "bundled-skills/skills/xcode-godmode/scripts/run_fork_tests.py",
  // 与 bootstrap/SEA 的必需路径对齐：执行脚本、加载器、矩阵报表与测量纪律三件套。
  "bundled-skills/skills/xcode-godmode/scripts/parseltongue.py",
  "bundled-skills/skills/xcode-godmode/scripts/godmode_probe.py",
  "bundled-skills/skills/xcode-godmode/scripts/godmode_race.py",
  "bundled-skills/skills/xcode-godmode/scripts/load_godmode.py",
  "bundled-skills/skills/xcode-godmode/scripts/matrix_report.py",
  "bundled-skills/skills/xcode-godmode/references/jailbreak-templates.md",
  "bundled-skills/skills/xcode-godmode/references/refusal-detection.md",
  "bundled-skills/skills/xcode-godmode/references/combination-attacks.md",
  "bundled-skills/skills/xcode-godmode/references/running-a-measurement.md",
  "bundled-skills/skills/xcode-godmode/references/measured-results.md",
  "bundled-skills/skills/xcode-godmode/templates/prefill.json",
  "bundled-skills/skills/xcode-godmode/templates/prefill-subtle.json",
  // 测量面：语料、打分器、运行器。SKILL.md 的 Paths 段逐个点了名，
  // 少一个就是文档指着不存在的脚本；这些文件不带密钥，纯粹是拒绝判定的基准。
  "bundled-skills/skills/xcode-godmode/scripts/safety_scoring.py",
  "bundled-skills/skills/xcode-godmode/scripts/csam_eval.py",
  "bundled-skills/skills/xcode-godmode/scripts/safety_suite.py",
  "bundled-skills/skills/xcode-godmode/scripts/safety_suite_runner.py",
  "bundled-skills/skills/xcode-godmode/scripts/unlock_matrix.py",
  "bundled-skills/skills/xcode-godmode/scripts/priming_eval.py",
  "bundled-skills/skills/xcode-godmode/scripts/safety_samples.py",
  "bundled-skills/skills/xcode-godmode/scripts/seed_library.py",
  "bundled-skills/skills/xcode-godmode/scripts/seed_library_b.py",
  "bundled-skills/skills/xcode-godmode/scripts/seed_library_c.py",
  "bundled-skills/skills/xcode-godmode/scripts/seed_library_cli.py",
  "bundled-skills/skills/xcode-godmode/scripts/seed_template.py",
  "bundled-skills/skills/xcode-godmode/scripts/auto_jailbreak.py",
  // 一次性运行器：各跑一种测量，import 时无副作用，缺了只是少一种跑法。
  "bundled-skills/skills/xcode-godmode/scripts/csam_focus_run.py",
  "bundled-skills/skills/xcode-godmode/scripts/csam_combo_run.py",
  "bundled-skills/skills/xcode-godmode/scripts/csam_continuation_run.py",
  "bundled-skills/skills/xcode-godmode/scripts/csam_quick_check.py",
  "bundled-skills/skills/xcode-godmode/scripts/csam_break_verify.py",
  // 离线回归：不需要 API key，改完打分器必须先跑这两个再花调用钱。
  "bundled-skills/skills/xcode-godmode/scripts/test_csam_eval.py",
  "bundled-skills/skills/xcode-godmode/scripts/test_safety_scoring.py",
  // 测量文档：打分器规则、样本与种子的纯文本版，报告里引 id 时由它们兜底。
  "bundled-skills/skills/xcode-godmode/references/safety-scorer-rules.md",
  "bundled-skills/skills/xcode-godmode/references/jailbreak-samples.md",
  "bundled-skills/skills/xcode-godmode/references/context-attack-seeds.md",
  // fork 自带的 manifest：XCode 不读它，随包只为和 fork 逐文件对齐。
  "bundled-skills/skills/xcode-godmode/skill.yaml",
  ...REMOTE_AGENT_OFFICIAL_PLUGIN_PACKAGE_NAMES.map(
    (packageName) => `${packageName}/.zcode-plugin/plugin.json`,
  ),
  // 只校验 Browser Use manifest 会把“有插件壳”的残缺目录
  // 误判为可复用。生产 remote、开发态 remote 与 release source 校验共用这份必需资产合同。
  //
  // 这里只能列 browser-use **自己产出**的资产。node_repl 宿主抽成 @zcode/node-repl-host 后
  // browser-use 不再产出 dist/mcp/server.js；
  // 本清单里指向不存在的文件，会让远端资产校验对着幽灵路径报缺失。
  // 远程工作区当前不承载 Browser Use / Computer Use，因此宿主 runtime 不进这份远端合同——
  // 要支持远程 bua/cua 时，应把 node-repl-host 补进上面的 PACKAGE_NAMES 并在此声明它的
  // dist/mcp/server.js，而不是把宿主产物挂回 browser-use 名下。
  "visualize-plugin/skills/visualize/SKILL.md",
  "visualize-plugin/skills/visualize/references/api.md",
  "visualize-plugin/skills/visualize/references/styles.md",
  "visualize-plugin/skills/visualize/tweak.md",
  "visualize-plugin/skills/visualize/LICENSE.md",
  "visualize-plugin/skills/visualize/scripts/render.py",
  "visualize-plugin/skills/visualize/assets/visualize.css",
  "visualize-plugin/skills/visualize/assets/visualize.html",
  "visualize-plugin/skills/visualize/assets/calendar.js",
  "visualize-plugin/skills/visualize/assets/runtime-manifest.json",
  "visualize-plugin/skills/visualize/scripts/vendor.py",
  "visualize-plugin/skills/visualize/assets/vendor/manifest.json",
  "visualize-plugin/skills/visualize/assets/vendor/floating-ui-core-1.7.3.min.js",
  "visualize-plugin/skills/visualize/assets/vendor/floating-ui-core-1.7.3.min.js.LICENSE",
  "visualize-plugin/skills/visualize/assets/vendor/floating-ui-dom-1.7.4.min.js",
  "visualize-plugin/skills/visualize/assets/vendor/floating-ui-dom-1.7.4.min.js.LICENSE",
  "visualize-plugin/skills/visualize/assets/vendor/lucide-1.17.0.js",
  "visualize-plugin/skills/visualize/assets/vendor/lucide-1.17.0.js.LICENSE",
  "visualize-plugin/skills/visualize/assets/vendor/d3-7.9.0.min.js",
  "visualize-plugin/skills/visualize/assets/vendor/d3-7.9.0.min.js.LICENSE",
  "visualize-plugin/skills/visualize/assets/standalone-host-bridge.js",
  "visualize-plugin/skills/visualize/assets/standalone-shell.js",
  "visualize-plugin/skills/visualize/widgets/calendar.md",
  "visualize-plugin/skills/visualize/examples/calendar.html",
  "browser-use-plugin/docs/api.json",
  "browser-use-plugin/docs/documents.json",
  "browser-use-plugin/docs/overview.md",
  // 远端缓存若缺少 recording 正文，documents.json 仍会错误宣告该 lookup 可用。
  "browser-use-plugin/docs/recording.md",
  "browser-use-plugin/docs/workflow.md",
  "browser-use-plugin/scripts/browser-client.mjs",
  "browser-use-plugin/skills/control-browser/SKILL.md",
  "browser-use-plugin/skills/web-gui-tester/SKILL.md",
  // 修复原因：仅校验 manifest 无法发现文档插件缺少技能正文或视觉评审 Agent。
  // 文档插件 0.2.0 起带查看面板，远端还必须有 office-runtime 构建出的 server 与面板资源。
  "image-search-plugin/.mcp.json",
  "documents-plugin/agents/visual-judge.md",
  "documents-plugin/skills/docx/SKILL.md",
  "documents-plugin/skills/docx-viewer/SKILL.md",
  "documents-plugin/dist/server.mjs",
  "documents-plugin/dist/ui/assets.json",
  "documents-plugin/dist/ui/panel.html",
  "pdf-plugin/agents/visual-judge.md",
  "pdf-plugin/skills/pdf/SKILL.md",
  "pdf-plugin/skills/pdf-viewer/SKILL.md",
  "pdf-plugin/dist/server.mjs",
  "pdf-plugin/dist/ui/assets.json",
  "pdf-plugin/dist/ui/panel.html",
  "presentations-plugin/agents/visual-judge.md",
  "presentations-plugin/skills/pptx/SKILL.md",
  "presentations-plugin/skills/pptx-viewer/SKILL.md",
  "presentations-plugin/dist/server.mjs",
  "presentations-plugin/dist/ui/assets.json",
  "presentations-plugin/dist/ui/panel.html",
  "spreadsheets-plugin/agents/visual-judge.md",
  "spreadsheets-plugin/skills/xlsx/SKILL.md",
  "spreadsheets-plugin/skills/xlsx-viewer/SKILL.md",
  "spreadsheets-plugin/dist/server.mjs",
  "spreadsheets-plugin/dist/ui/assets.json",
  "spreadsheets-plugin/dist/ui/panel.html",
  "zcode-cua-plugin/docs/computer-use.md",
  "zcode-cua-plugin/scripts/computer-use-client.mjs",
  "zcode-cua-plugin/skills/computer-use/SKILL.md",
] as const;

export function buildRemoteAgentOfficialPluginDir(remoteProviderDir: string): string {
  return posix.join(remoteProviderDir, REMOTE_AGENT_OFFICIAL_PLUGIN_DIR_NAME);
}

export function buildRemoteAgentOfficialPluginSourceRelativePath(params: {
  runtimeResourceDir: string;
  platformArch: string;
}): string {
  return posix.join(
    params.runtimeResourceDir,
    params.platformArch,
    REMOTE_AGENT_OFFICIAL_PLUGIN_DIR_NAME,
  );
}

export function buildRemoteAgentOfficialPluginRequiredPaths(remoteProviderDir: string): string[] {
  const remoteOfficialPluginDir = buildRemoteAgentOfficialPluginDir(remoteProviderDir);
  return REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS.map((relativePath) =>
    posix.join(remoteOfficialPluginDir, relativePath),
  );
}
