import { button, el, modalShell } from "./html/components";

/** Phone firing is a deliberate hold followed by release, never a key hold. */
export class GuardedFire {
  private pointer: number | null = null;
  private started = 0;
  private frame = 0;
  private confirmation: HTMLDialogElement | null = null;
  private label: string;
  static readonly holdMs = 600;

  constructor(readonly element: HTMLButtonElement, private action: () => void) {
    this.label = element.textContent || "Fire";
    element.classList.add("lan-guarded-fire");
    element.onpointerdown = (event) => {
      event.preventDefault();
      if (this.pointer !== null || !event.isPrimary) { this.cancel(); return; }
      if (event.button !== 0 || element.disabled) return;
      this.closeConfirmation();
      this.pointer = event.pointerId;
      this.started = performance.now();
      element.setPointerCapture(event.pointerId);
      this.tick();
    };
    element.onpointermove = (event) => {
      if (event.pointerId === this.pointer && !this.inside(event)) this.cancel();
    };
    element.onpointerup = (event) => {
      event.preventDefault();
      if (event.pointerId !== this.pointer) return;
      const fire = performance.now() - this.started >= GuardedFire.holdMs && this.inside(event);
      this.cancel();
      if (fire) this.commit();
    };
    element.onpointercancel = element.onlostpointercapture = () => this.cancel();
    element.oncontextmenu = (event) => event.preventDefault();
    element.onclick = (event) => {
      // Native keyboard and assistive-technology clicks have no pointer gesture.
      if (event.detail === 0 && !element.disabled) this.confirm();
    };
    document.addEventListener("pointerdown", this.otherPointer, true);
    this.paint();
  }

  private otherPointer = (event: PointerEvent): void => {
    if (this.pointer !== null && event.pointerId !== this.pointer) this.cancel();
  };

  private inside(event: PointerEvent): boolean {
    const r = this.element.getBoundingClientRect();
    return event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
  }

  private tick = (): void => {
    if (this.pointer === null) return;
    if (this.element.disabled || !this.element.isConnected) { this.cancel(); return; }
    this.paint();
    this.frame = requestAnimationFrame(this.tick);
  };

  private paint(): void {
    const progress = this.pointer === null ? 0 : Math.min(1, (performance.now() - this.started) / GuardedFire.holdMs);
    const label = progress >= 1 ? "Release to fire" : `Hold to ${this.label.toLowerCase()}`;
    if (this.element.textContent !== label) this.element.textContent = label;
    this.element.setAttribute("aria-label", label);
    this.element.dataset.fireLabel = this.label;
    this.element.dataset.fireState = progress >= 1 ? "ready" : this.pointer !== null ? "holding" : "idle";
    this.element.style.setProperty("--fire-progress", String(progress));
    this.element.title = "Hold for a moment, then release to fire. Slide off to cancel.";
  }

  update(label: string, disabled: boolean): void {
    this.label = label;
    this.element.disabled = disabled;
    if (disabled) this.cancel();
    this.paint();
  }

  /** Forget this gesture completely; moving back over the button cannot resume it. */
  cancel(): void {
    const pointer = this.pointer;
    this.pointer = null;
    cancelAnimationFrame(this.frame);
    if (pointer !== null && this.element.hasPointerCapture(pointer)) this.element.releasePointerCapture(pointer);
    this.closeConfirmation();
    this.paint();
  }

  reset(): void { this.cancel(); }

  private commit(): void {
    if (this.element.disabled || !this.element.isConnected) return;
    this.paint();
    this.action();
  }

  private closeConfirmation(): void {
    if (!this.confirmation) return;
    this.confirmation.close();
    this.confirmation.remove();
    this.confirmation = null;
  }

  private confirm(): void {
    if (this.confirmation) return;
    const dialog = modalShell({ cancel: () => this.cancel(), className: "lan-fire-confirm" });
    dialog.setAttribute("aria-label", "Confirm shot");
    const cancel = button("Cancel", () => this.cancel());
    const fire = button(this.label, () => { this.closeConfirmation(); this.commit(); });
    const actions = el("div", "", "ui-dialog-footer");
    actions.append(cancel, fire);
    dialog.append(el("h2", "Fire this shot?"), el("p", "Your current weapon, angle and power will be used."), actions);
    document.body.append(dialog);
    this.confirmation = dialog;
    dialog.showModal();
    cancel.focus();
  }

  dispose(): void {
    this.cancel();
    document.removeEventListener("pointerdown", this.otherPointer, true);
  }
}
