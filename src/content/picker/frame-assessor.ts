/**
 * Cross-Frame Behavior Assessment Utility
 * Detects iframe nesting, same-origin vs cross-origin boundaries, sandboxing,
 * and provides safe diagnostics for DOM inspection.
 */

import { CrossFrameAssessment } from './types';

/**
 * Assesses the environment of the current window/frame.
 */
export function assessCurrentFrame(win: Window = window): CrossFrameAssessment {
  const isIframe = win.self !== win.top;

  let isCrossOrigin = false;
  let frameDepth = 0;
  let isSandboxed = false;
  let warning: string | undefined;

  // Check sandboxed origin
  if (win.origin === 'null' || win.location.protocol === 'about:') {
    isSandboxed = true;
  }

  if (isIframe) {
    let currentWin: Window = win;
    try {
      while (currentWin !== win.top && currentWin.parent && currentWin.parent !== currentWin) {
        frameDepth++;
        // Attempting to access parent's location will throw SecurityError / DOMException if cross-origin
        const parentLocation = currentWin.parent.location.href;
        if (!parentLocation) {
          isCrossOrigin = true;
          break;
        }
        currentWin = currentWin.parent;
      }
    } catch {
      isCrossOrigin = true;
      warning = 'This frame is cross-origin. Direct DOM access across cross-origin iframes is restricted by browser security policies.';
    }

    if (isSandboxed && !warning) {
      warning = 'This frame appears to be sandboxed (unique null origin).';
    }
  }

  return {
    isIframe,
    isCrossOrigin,
    frameDepth,
    isSandboxed,
    warning
  };
}

/**
 * Assesses a specific DOM element to detect whether it is an iframe or hosted inside a sub-document.
 */
export function assessTargetElementFrame(element: Element): CrossFrameAssessment {
  if (!(element instanceof Element)) {
    return {
      isIframe: false,
      isCrossOrigin: false,
      frameDepth: 0,
      isSandboxed: false
    };
  }

  // 1. If element itself is an IFRAME
  if (element.tagName.toLowerCase() === 'iframe') {
    const iframeEl = element as HTMLIFrameElement;
    let isCrossOrigin = false;
    let warning: string | undefined;

    try {
      // Accessing contentDocument will throw or be null if cross-origin
      const doc = iframeEl.contentDocument;
      if (!doc) {
        isCrossOrigin = true;
        warning = 'Target is a cross-origin iframe. The extension content script runs inside each frame independently.';
      }
    } catch {
      isCrossOrigin = true;
      warning = 'Target is a cross-origin iframe. Direct DOM inspection into child iframe is blocked by the Same-Origin Policy.';
    }

    const isSandboxed = iframeEl.hasAttribute('sandbox');

    return {
      isIframe: true,
      isCrossOrigin,
      frameDepth: 1,
      isSandboxed,
      warning
    };
  }

  // 2. Check if element belongs to a different window from current global window
  const elementWin = element.ownerDocument.defaultView;
  if (elementWin && elementWin !== window) {
    return assessCurrentFrame(elementWin);
  }

  // 3. Fallback to current window assessment
  return assessCurrentFrame();
}
