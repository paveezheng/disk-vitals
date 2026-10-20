/** 动效工具。所有动画都尊重系统「减弱动态效果」设置。 */
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 用 View Transition 包裹一次状态更新；不支持或开启减弱动态效果时直接更新。
 * 过渡样式见 index.css 的 ::view-transition-*(detail)。
 */
export function withViewTransition(update: () => void): void {
  if (!("startViewTransition" in document) || prefersReducedMotion()) {
    update();
    return;
  }
  document.startViewTransition(() => flushSync(update));
}

/**
 * 数值从当前显示值缓动到 target，新的 target 会从当前位置接着走（可打断）。
 * 首次挂载从 0 开始，用作入场动画。
 */
export function useCountUp(target: number, duration = 800): number {
  const [value, setValue] = useState(0);
  const valueRef = useRef(0);

  useEffect(() => {
    const from = valueRef.current;
    if (from === target) return;
    if (prefersReducedMotion()) {
      valueRef.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      const eased = 1 - (1 - t) ** 3; // easeOutCubic
      valueRef.current = from + (target - from) * eased;
      setValue(valueRef.current);
      if (t < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return value;
}

/** flag 持续为 true 超过 delay 毫秒才返回 true，避免加载态一闪而过 */
export function useDelayedFlag(flag: boolean, delay: number): boolean {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (!flag) {
      setElapsed(false);
      return;
    }
    const id = window.setTimeout(() => setElapsed(true), delay);
    return () => window.clearTimeout(id);
  }, [flag, delay]);

  return flag && elapsed;
}
