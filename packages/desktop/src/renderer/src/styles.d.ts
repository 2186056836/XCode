/**
 * renderer 侧的样式表导入放行。
 *
 * CSS 由 Vite 负责解析与打包，类型侧只需要让副作用导入成立，
 * 否则 `import "@zcode/ui/styles.css"` 会报 TS2882。
 *
 * 注意：本文件必须保持「全局脚本」形态（不能有顶层 import/export），
 * 否则下面的 shorthand ambient module 声明会被当成模块增强而失效。
 */
declare module "*.css";
declare module "@zcode/ui/styles.css";
