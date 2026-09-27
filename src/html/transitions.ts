import { sfx } from "../sound";

/** One transition for screen-backed and standalone dialogs. */
export function animateDialog(element: HTMLElement, opening: boolean, sound: boolean, done?: () => void): Animation | null {
  sfx.play(opening ? "dialog_open" : "dialog_close", sound);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !element.animate) { done?.(); return null; }
  const frames = [{ transform: "scale(.05)", opacity: .2 }, { transform: "scale(1)", opacity: 1 }];
  const animation = element.animate(opening ? frames : frames.reverse(), { duration: 1000 / 3, easing: "linear" });
  const finish = () => {
    animation.onfinish = animation.oncancel = null;
    done?.();
  };
  animation.onfinish = animation.oncancel = finish;
  return animation;
}
