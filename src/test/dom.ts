import { Window } from "happy-dom";

let windowRef: Window | null = null;

export function installDom(): void {
  if (windowRef) return;
  windowRef = new Window({ url: "http://localhost:3000" });
  const win = windowRef as unknown as Window & typeof globalThis;
  Object.defineProperty(globalThis, "window", { value: win, configurable: true });
  Object.defineProperty(globalThis, "document", {
    value: win.document,
    configurable: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    value: win.navigator,
    configurable: true,
  });
  Object.defineProperty(globalThis, "HTMLElement", {
    value: win.HTMLElement,
    configurable: true,
  });
  Object.defineProperty(globalThis, "DocumentFragment", {
    value: win.DocumentFragment,
    configurable: true,
  });
  Object.defineProperty(globalThis, "MutationObserver", {
    value: win.MutationObserver,
    configurable: true,
  });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    value: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number,
    configurable: true,
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    value: (id: number) => clearTimeout(id),
    configurable: true,
  });
  try {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
      value: true,
      configurable: true,
      writable: true,
    });
  } catch {
    // Ignore if the host already sealed this flag.
  }
}

export function cleanupDom(): void {
  windowRef?.happyDOM.close();
  windowRef = null;
}
