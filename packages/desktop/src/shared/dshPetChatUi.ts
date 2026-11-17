/**
 * 对话弹窗的样式与尺寸参数（逐字取自上游 src/shared/chat/styles.ts）：
 * 一条自适应输入框（无标题）+ 一行图标按钮（上传 / 截屏）+ 可选的图片预览；
 * 初始 160px，随输入增宽、封顶 340px 后折行增高；回车发送，Esc 或点外关闭。
 */
export const CHAT_CSS = [
  ".dsh-pet-chat{position:fixed;z-index:2147483001;width:160px;max-width:80vw;",
  "background:rgba(255,255,255,.98);border:1px solid rgba(0,0,0,.12);border-radius:10px;",
  "box-shadow:0 10px 32px rgba(0,0,0,.22);color:#2b2b2b;font-size:14px;line-height:1.5;",
  // 字体与桌宠气泡同款：字体族走全局变量 --dsh-pet-font-family（弹窗挂在 body 下，
  // 继承不到宠物根容器，由渲染层注入到 documentElement）。字号固定 14px。
  "font-family:var(--dsh-pet-font-family,'ShangshouSoftCandy','Yuanti SC','YouYuan','幼圆','Comic Sans MS','PingFang SC','Microsoft YaHei',sans-serif);",
  "user-select:none}",
  ".dsh-pet-chat *{box-sizing:border-box}",
  ".dsh-pet-chat-input{display:block;width:100%;border:none;outline:none;background:transparent;",
  "padding:8px 11px 9px;font-size:14px;line-height:1.45;color:#2b2b2b;font-family:inherit;",
  "resize:none;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere}",
  ".dsh-pet-chat-input::placeholder{color:rgba(43,43,43,.45)}",
  ".dsh-pet-chat-input:disabled{opacity:.55}",
  ".dsh-pet-chat-actions{display:flex;align-items:center;gap:6px;padding:0 8px 7px}",
  ".dsh-pet-chat-btn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;",
  "border:none;border-radius:6px;background:transparent;color:rgba(43,43,43,.62);font-size:14px;line-height:1;",
  "cursor:pointer;transition:background .15s,color .15s}",
  ".dsh-pet-chat-btn:hover{background:rgba(0,0,0,.06);color:rgba(43,43,43,.9)}",
  ".dsh-pet-chat-btn:disabled{opacity:.45;cursor:default}",
  ".dsh-pet-chat-btn svg{display:block}",
  ".dsh-pet-chat-attach{display:none;align-items:center;gap:4px;margin-left:2px}",
  '.dsh-pet-chat-attach[data-on="1"]{display:inline-flex}',
  ".dsh-pet-chat-thumb{width:24px;height:24px;object-fit:cover;border-radius:4px;",
  "border:1px solid rgba(0,0,0,.1);flex:0 0 auto;background:rgba(0,0,0,.06)}",
  ".dsh-pet-chat-attach-x{border:none;background:transparent;color:rgba(43,43,43,.45);cursor:pointer;",
  "font-size:12px;line-height:1;padding:2px 3px;border-radius:4px}",
  ".dsh-pet-chat-attach-x:hover{background:rgba(0,0,0,.08);color:rgba(43,43,43,.85)}",
  ".dsh-pet-chat-hint{display:none;color:rgba(43,43,43,.55);font-size:12px;padding:0 12px 8px}",
  ".dsh-pet-chat-err{color:#d94f3d;font-size:12px;padding:0 12px 8px;white-space:pre-wrap;overflow-wrap:anywhere}",
].join("");

/** 输入框宽度自适应参数：初始小宽，随文本增宽，封顶后折行增高。 */
export const CHAT_MIN_W = 160;
export const CHAT_MAX_W = 340;
/** 输入框水平 padding 补偿（11×2）。 */
export const CHAT_H_PAD = 22;
