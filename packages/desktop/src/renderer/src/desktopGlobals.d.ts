/**
 * renderer 侧的 window 桥接类型入口。
 *
 * `window.zcode` 的全局声明定义在 @zcode/client 的 globals.d.ts 里（preload 与 renderer 共用同一份契约）。
 * renderer 工程的 include 只覆盖 src/renderer，@zcode/client 又是 project reference（只会把编译产物
 * index.d.ts 引入类型程序），声明文件本身不会进 renderer 的类型程序，于是 window.zcode 变成未声明属性。
 * 这里显式把该声明文件引入 renderer 类型程序，避免两边各写一份 global 声明而漂移。
 *
 * 注意：本文件因为有顶层 import 而是「模块」，shorthand ambient module 声明在模块里会被当成模块增强而失效，
 * 所以 CSS 的放行声明放在同目录的 styles.d.ts（全局脚本形态）里。
 */
import "@zcode/client/globals";
