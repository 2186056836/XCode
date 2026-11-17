/**
 * 点击音效（逐条对齐 dsh-pet `src/client/pet/click-sound.ts`）：
 * 模块级单例 audio、100ms 连点节流、音量 0.5、播放失败一律静默
 * （没有声音也不该有报错）。开关由配置 `clickSoundEnabled` 驱动，
 * 配置未加载前保守静音。
 */
const CLICK_SOUND_URL = "pets-dsh/sound/click-duck.wav";
const CLICK_SOUND_VOLUME = 0.5;
const CLICK_SOUND_THROTTLE_MS = 100;

let clickAudio: HTMLAudioElement | null = null;
let lastClickSoundAt = 0;
let clickSoundEnabled = false;

/** 打开或关闭点击音效（配置里的 `clickSoundEnabled`）。 */
export function setClickSoundEnabled(enabled: boolean): void {
  clickSoundEnabled = enabled;
}

/** 播放点击音效；开关关闭、节流中或音频不可用时静默返回。 */
export function playClickSound(): void {
  if (!clickSoundEnabled) return;
  const now = Date.now();
  if (now - lastClickSoundAt < CLICK_SOUND_THROTTLE_MS) return;
  lastClickSoundAt = now;
  try {
    clickAudio ??= new Audio(CLICK_SOUND_URL);
    clickAudio.volume = CLICK_SOUND_VOLUME;
    clickAudio.currentTime = 0;
    void clickAudio.play().catch(() => undefined);
  } catch {
    /* 音频不可用，静默忽略。 */
  }
}
