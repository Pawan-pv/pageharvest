/**
 * Isolated Visual Overlay Manager using Shadow DOM.
 * Renders hover highlights, selection outlines, matching elements boxes,
 * and an interactive floating toolbar without host CSS contamination.
 */

import {
  ElementBreadcrumb,
  PickerOptions,
  SelectedElementInfo,
  HoverElementInfo
} from './types';

const OVERLAY_HOST_ID = 'pageharvest-picker-overlay-host';

export class PickerOverlay {
  private hostElement: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;

  // Visual overlay elements inside Shadow DOM
  private hoverBox: HTMLElement | null = null;
  private hoverBadge: HTMLElement | null = null;
  private selectionBox: HTMLElement | null = null;
  private selectionBadge: HTMLElement | null = null;
  private similarBoxesContainer: HTMLElement | null = null;
  private toolbar: HTMLElement | null = null;

  // Options and state
  private options: PickerOptions;
  private isAttached = false;

  // Event handlers to delegate toolbar clicks
  private onParentClick?: () => void;
  private onBreadcrumbClick?: (breadcrumb: ElementBreadcrumb) => void;
  private onConfirmClick?: () => void;
  private onCancelClick?: () => void;

  constructor(options: PickerOptions = {}) {
    this.options = {
      highlightColor: '#2563eb', // Indigo / blue for hover
      selectedColor: '#10b981',  // Emerald / green for selected
      similarColor: '#6366f1',   // Violet for similar
      showToolbar: true,
      showSimilar: true,
      ...options
    };
  }

  /**
   * Initializes and injects the isolated Shadow DOM overlay into the document.
   */
  public attach(callbacks?: {
    onParent?: () => void;
    onBreadcrumb?: (b: ElementBreadcrumb) => void;
    onConfirm?: () => void;
    onCancel?: () => void;
  }): void {
    if (this.isAttached) return;

    if (callbacks) {
      this.onParentClick = callbacks.onParent;
      this.onBreadcrumbClick = callbacks.onBreadcrumb;
      this.onConfirmClick = callbacks.onConfirm;
      this.onCancelClick = callbacks.onCancel;
    }

    // 1. Always start from a fresh host. A leftover one cannot be reused, because an
    //    element only ever accepts one shadow root.
    document.getElementById(OVERLAY_HOST_ID)?.remove();
    const host = document.createElement('div');
    host.id = OVERLAY_HOST_ID;
    host.setAttribute('data-pageharvest-ignore', 'true');
    (document.body || document.documentElement).appendChild(host);
    this.hostElement = host;

    // 2. Attach a closed Shadow DOM. The only reference to the root is this private field.
    this.shadowRoot = host.attachShadow({ mode: 'closed' });

    // 3. Inject reset and isolated styles
    const styleEl = document.createElement('style');
    styleEl.textContent = this.getOverlayStyles();
    this.shadowRoot.appendChild(styleEl);

    // 4. Create root container inside shadow DOM
    const container = document.createElement('div');
    container.className = 'ph-root-container';

    // Hover elements
    this.hoverBox = document.createElement('div');
    this.hoverBox.className = 'ph-hover-box ph-hidden';
    this.hoverBadge = document.createElement('div');
    this.hoverBadge.className = 'ph-hover-badge ph-hidden';
    container.appendChild(this.hoverBox);
    container.appendChild(this.hoverBadge);

    // Similar matches container
    this.similarBoxesContainer = document.createElement('div');
    this.similarBoxesContainer.className = 'ph-similar-container';
    container.appendChild(this.similarBoxesContainer);

    // Selection elements
    this.selectionBox = document.createElement('div');
    this.selectionBox.className = 'ph-selection-box ph-hidden';
    this.selectionBadge = document.createElement('div');
    this.selectionBadge.className = 'ph-selection-badge ph-hidden';
    container.appendChild(this.selectionBox);
    container.appendChild(this.selectionBadge);

    // Corner target accents: precision scanner corners on hover + selection boxes.
    const decorateCorners = (parent: HTMLElement): void => {
      for (const corner of ['tl', 'tr', 'bl', 'br']) {
        const accent = document.createElement('div');
        accent.className = `ph-corner-accent ph-corner-${corner}`;
        parent.appendChild(accent);
      }
    };
    if (this.hoverBox) decorateCorners(this.hoverBox);
    if (this.selectionBox) decorateCorners(this.selectionBox);

    // Floating Toolbar
    if (this.options.showToolbar !== false) {
      this.toolbar = document.createElement('div');
      this.toolbar.className = 'ph-toolbar ph-hidden';
      container.appendChild(this.toolbar);
    }

    this.shadowRoot.appendChild(container);
    this.isAttached = true;
  }

  /**
   * Updates the hover highlight to surround the target element.
   */
  public updateHover(info: HoverElementInfo | null): void {
    if (!this.hoverBox || !this.hoverBadge) return;

    if (!info) {
      this.hoverBox.classList.add('ph-hidden');
      this.hoverBadge.classList.add('ph-hidden');
      return;
    }

    const { rect, tagName, classList, selector } = info;

    // Position hover outline
    this.hoverBox.style.top = `${rect.top}px`;
    this.hoverBox.style.left = `${rect.left}px`;
    this.hoverBox.style.width = `${rect.width}px`;
    this.hoverBox.style.height = `${rect.height}px`;
    this.hoverBox.classList.remove('ph-hidden');

    // Position hover badge
    const badgeTop = rect.top > 32 ? rect.top - 26 : rect.top + rect.height + 6;
    const badgeLeft = Math.max(8, rect.left);

    const classPreview = classList.length > 0 ? `.${classList.slice(0, 2).join('.')}` : '';
    this.hoverBadge.textContent = `${tagName}${classPreview} (${Math.round(rect.width)}×${Math.round(rect.height)})`;
    this.hoverBadge.style.top = `${badgeTop}px`;
    this.hoverBadge.style.left = `${badgeLeft}px`;
    this.hoverBadge.title = selector;
    this.hoverBadge.classList.remove('ph-hidden');
  }

  /**
   * Updates the selection outline, matching boxes, and floating toolbar.
   */
  public updateSelection(info: SelectedElementInfo | null): void {
    if (!this.selectionBox || !this.selectionBadge) return;

    if (!info) {
      this.selectionBox.classList.add('ph-hidden');
      this.selectionBadge.classList.add('ph-hidden');
      this.clearSimilarHighlights();
      if (this.toolbar) {
        this.toolbar.classList.add('ph-hidden');
      }
      return;
    }

    const { rect, tagName, selector, matchCount } = info;

    // 1. Position selection box
    this.selectionBox.style.top = `${rect.top}px`;
    this.selectionBox.style.left = `${rect.left}px`;
    this.selectionBox.style.width = `${rect.width}px`;
    this.selectionBox.style.height = `${rect.height}px`;
    this.selectionBox.classList.remove('ph-hidden');

    // 2. Position selection badge
    const badgeTop = rect.top > 32 ? rect.top - 28 : rect.top + rect.height + 6;
    this.selectionBadge.textContent = `SELECTED: ${tagName} (${matchCount} ${matchCount === 1 ? 'match' : 'matches'})`;
    this.selectionBadge.style.top = `${badgeTop}px`;
    this.selectionBadge.style.left = `${Math.max(8, rect.left)}px`;
    this.selectionBadge.classList.remove('ph-hidden');

    // 3. Highlight similar elements if requested
    const similarSel = info.similarSelector || selector;
    if (this.options.showSimilar !== false && similarSel) {
      this.highlightSimilarElements(similarSel, info.element);
    } else {
      this.clearSimilarHighlights();
    }

    // 4. Render and show floating toolbar
    if (this.toolbar && this.options.showToolbar !== false) {
      this.renderToolbar(info);
      this.toolbar.classList.remove('ph-hidden');
    }
  }

  /**
   * Highlights all elements on the page matching the given selector (except current element).
   */
  public highlightSimilarElements(selector: string, currentElement: Element): void {
    if (!this.similarBoxesContainer) return;
    this.clearSimilarHighlights();

    if (!selector) return;

    try {
      const matches = document.querySelectorAll(selector);
      const fragment = document.createDocumentFragment();

      matches.forEach((el) => {
        if (el === currentElement) return;
        if (this.isPickerElement(el)) return;

        const rect = el.getBoundingClientRect();
        const top = rect.top;
        const left = rect.left;
        const width = rect.width || 120;
        const height = rect.height || 30;

        const box = document.createElement('div');
        box.className = 'ph-similar-box';
        box.style.top = `${top}px`;
        box.style.left = `${left}px`;
        box.style.width = `${width}px`;
        box.style.height = `${height}px`;

        fragment.appendChild(box);
      });

      this.similarBoxesContainer.appendChild(fragment);
    } catch {
      // Ignore query errors
    }
  }

  /**
   * Clears all similar elements highlight boxes.
   */
  public clearSimilarHighlights(): void {
    if (this.similarBoxesContainer) {
      this.similarBoxesContainer.innerHTML = '';
    }
  }

  /**
   * Renders the interactive selection toolbar inside Shadow DOM.
   */
  private renderToolbar(info: SelectedElementInfo): void {
    if (!this.toolbar) return;
    this.toolbar.innerHTML = '';

    // Header with title and cross-frame warning if present
    const header = document.createElement('div');
    header.className = 'ph-toolbar-header';

    const title = document.createElement('span');
    title.className = 'ph-toolbar-title';
    const brand = document.createElement('strong');
    brand.textContent = 'PageHarvest';
    title.append(brand, document.createTextNode(' Element Selected'));
    header.appendChild(title);

    if (info.crossFrame?.warning) {
      const warningPill = document.createElement('span');
      warningPill.className = 'ph-warning-pill';
      warningPill.textContent = 'Cross-Origin Frame';
      warningPill.title = info.crossFrame.warning;
      header.appendChild(warningPill);
    }

    this.toolbar.appendChild(header);

    // Selected Selector & Tag Details
    const detailsRow = document.createElement('div');
    detailsRow.className = 'ph-toolbar-details';

    const selectorCode = document.createElement('code');
    selectorCode.className = 'ph-selector-code';
    selectorCode.textContent = info.selector;
    selectorCode.title = `Full selector: ${info.selector}`;
    detailsRow.appendChild(selectorCode);

    const matchBadge = document.createElement('span');
    matchBadge.className = 'ph-match-badge';
    matchBadge.textContent = `${info.matchCount} ${info.matchCount === 1 ? 'match' : 'matches'}`;
    detailsRow.appendChild(matchBadge);

    this.toolbar.appendChild(detailsRow);

    // Breadcrumb Hierarchy
    if (info.breadcrumbs && info.breadcrumbs.length > 0) {
      const breadcrumbBar = document.createElement('div');
      breadcrumbBar.className = 'ph-breadcrumb-bar';

      const label = document.createElement('span');
      label.className = 'ph-breadcrumb-label';
      label.textContent = 'Hierarchy:';
      breadcrumbBar.appendChild(label);

      const trail = document.createElement('div');
      trail.className = 'ph-breadcrumb-trail';

      info.breadcrumbs.forEach((bc, idx) => {
        if (idx > 0) {
          const sep = document.createElement('span');
          sep.className = 'ph-breadcrumb-separator';
          sep.textContent = '›';
          trail.appendChild(sep);
        }

        const item = document.createElement('button');
        item.type = 'button';
        item.className = `ph-breadcrumb-item ${bc.element === info.element ? 'ph-active' : ''}`;
        item.textContent = bc.label;
        item.title = `Select ${bc.selector}`;
        item.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (this.onBreadcrumbClick) {
            this.onBreadcrumbClick(bc);
          }
        });
        trail.appendChild(item);
      });

      breadcrumbBar.appendChild(trail);
      this.toolbar.appendChild(breadcrumbBar);
    }

    // Action Buttons Row
    const actionsRow = document.createElement('div');
    actionsRow.className = 'ph-toolbar-actions';

    // "Select Parent" Button
    const hasParent = !!info.element.parentElement && info.element.parentElement !== document.documentElement;
    const parentBtn = document.createElement('button');
    parentBtn.type = 'button';
    parentBtn.className = 'ph-btn ph-btn-secondary ph-btn-parent';
    parentBtn.textContent = '▲ Select Parent';
    parentBtn.disabled = !hasParent;
    parentBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.onParentClick) this.onParentClick();
    });
    actionsRow.appendChild(parentBtn);

    const rightActions = document.createElement('div');
    rightActions.className = 'ph-toolbar-actions-right';

    // "Cancel" Button
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'ph-btn ph-btn-cancel';
    cancelBtn.textContent = '✕ Cancel';
    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.onCancelClick) this.onCancelClick();
    });
    rightActions.appendChild(cancelBtn);

    // "Confirm" Button
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'ph-btn ph-btn-primary ph-btn-confirm';
    confirmBtn.textContent = '✓ Confirm Selection';
    confirmBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.onConfirmClick) this.onConfirmClick();
    });
    rightActions.appendChild(confirmBtn);

    actionsRow.appendChild(rightActions);
    this.toolbar.appendChild(actionsRow);
  }

  /**
   * Checks if an element belongs to the picker overlay.
   */
  public isPickerElement(target: EventTarget | null): boolean {
    if (!target || !(target instanceof Node)) return false;
    if (this.hostElement && (this.hostElement === target || this.hostElement.contains(target))) {
      return true;
    }
    if (this.shadowRoot && this.shadowRoot.contains(target)) {
      return true;
    }
    if (target instanceof Element && target.getAttribute('data-pageharvest-ignore')) {
      return true;
    }
    return false;
  }

  /**
   * Cleans up all injected elements and removes host from DOM.
   */
  public destroy(): void {
    if (this.hostElement && this.hostElement.parentNode) {
      this.hostElement.parentNode.removeChild(this.hostElement);
    }
    this.hostElement = null;
    this.shadowRoot = null;
    this.hoverBox = null;
    this.hoverBadge = null;
    this.selectionBox = null;
    this.selectionBadge = null;
    this.similarBoxesContainer = null;
    this.toolbar = null;
    this.isAttached = false;
  }

  /**
   * CSS stylesheet injected into the Shadow Root.
   * Completely isolated and reset so target website CSS cannot distort it.
   */
  private getOverlayStyles(): string {
    return `
      :host {
        all: initial !important;
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        z-index: 2147483647 !important;
        pointer-events: none !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
        font-size: 13px !important;
        line-height: 1.4 !important;
        box-sizing: border-box !important;
      }

      *, *::before, *::after {
        box-sizing: border-box !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      .ph-hidden {
        display: none !important;
      }

      /* Corner Target Accents (precision scanner corners) */
      .ph-corner-accent {
        position: absolute !important;
        width: 12px !important;
        height: 12px !important;
        pointer-events: none !important;
        border: 0 solid #00f5d4 !important;
        filter: drop-shadow(0 0 5px rgba(0, 245, 212, 0.9)) !important;
        z-index: 2147483641 !important;
      }

      .ph-corner-tl {
        top: -3px !important;
        left: -3px !important;
        border-top-width: 2.5px !important;
        border-left-width: 2.5px !important;
        border-top-left-radius: 6px !important;
      }

      .ph-corner-tr {
        top: -3px !important;
        right: -3px !important;
        border-top-width: 2.5px !important;
        border-right-width: 2.5px !important;
        border-top-right-radius: 6px !important;
      }

      .ph-corner-bl {
        bottom: -3px !important;
        left: -3px !important;
        border-bottom-width: 2.5px !important;
        border-left-width: 2.5px !important;
        border-bottom-left-radius: 6px !important;
      }

      .ph-corner-br {
        bottom: -3px !important;
        right: -3px !important;
        border-bottom-width: 2.5px !important;
        border-right-width: 2.5px !important;
        border-bottom-right-radius: 6px !important;
      }

      /* Hover Highlight Box — electric cyan neon */
      .ph-hover-box {
        position: fixed !important;
        border: 2px solid #00f5d4 !important;
        background: linear-gradient(135deg, rgba(0, 245, 212, 0.12) 0%, rgba(16, 185, 129, 0.08) 100%) !important;
        border-radius: 4px !important;
        pointer-events: none !important;
        transition: top 80ms ease-out, left 80ms ease-out, width 80ms ease-out, height 80ms ease-out !important;
        z-index: 2147483640 !important;
        box-shadow: 0 0 14px rgba(0, 245, 212, 0.75), inset 0 0 10px rgba(0, 245, 212, 0.2) !important;
      }

      /* Neon Floating Tooltip Badge — dark glassmorphic */
      .ph-hover-badge {
        position: fixed !important;
        background-color: rgba(10, 15, 28, 0.92) !important;
        -webkit-backdrop-filter: blur(8px) !important;
        backdrop-filter: blur(8px) !important;
        color: #00f5d4 !important;
        text-shadow: 0 0 6px rgba(0, 245, 212, 0.6) !important;
        font-size: 11px !important;
        font-weight: 600 !important;
        padding: 3px 8px !important;
        border-radius: 6px !important;
        pointer-events: none !important;
        z-index: 2147483645 !important;
        box-shadow: 0 0 10px rgba(0, 245, 212, 0.35), 0 2px 6px rgba(0, 0, 0, 0.3) !important;
        white-space: nowrap !important;
        border: 1px solid rgba(0, 245, 212, 0.55) !important;
      }

      /* Selection Highlight Box — neon emerald/violet locked pulse */
      .ph-selection-box {
        position: fixed !important;
        border: 2.5px solid #10b981 !important;
        background: linear-gradient(135deg, rgba(16, 185, 129, 0.16) 0%, rgba(168, 85, 247, 0.12) 100%) !important;
        border-radius: 4px !important;
        pointer-events: none !important;
        z-index: 2147483642 !important;
        box-shadow: 0 0 16px rgba(16, 185, 129, 0.75), 0 0 30px rgba(168, 85, 247, 0.5), inset 0 0 12px rgba(16, 185, 129, 0.3) !important;
        animation: ph-selection-pulse 1.6s ease-in-out infinite !important;
      }

      @keyframes ph-selection-pulse {
        0%, 100% {
          box-shadow: 0 0 16px rgba(16, 185, 129, 0.75), 0 0 30px rgba(168, 85, 247, 0.5), inset 0 0 12px rgba(16, 185, 129, 0.3);
        }
        50% {
          box-shadow: 0 0 22px rgba(16, 185, 129, 0.95), 0 0 44px rgba(168, 85, 247, 0.75), inset 0 0 16px rgba(168, 85, 247, 0.45);
        }
      }

      .ph-selection-box .ph-corner-accent {
        border-color: #a855f7 !important;
        filter: drop-shadow(0 0 5px rgba(168, 85, 247, 0.9)) !important;
      }

      .ph-selection-badge {
        position: fixed !important;
        background-color: rgba(10, 15, 28, 0.92) !important;
        -webkit-backdrop-filter: blur(8px) !important;
        backdrop-filter: blur(8px) !important;
        color: #34d399 !important;
        text-shadow: 0 0 8px rgba(16, 185, 129, 0.7) !important;
        font-size: 11px !important;
        font-weight: 700 !important;
        padding: 4px 10px !important;
        border-radius: 6px !important;
        pointer-events: none !important;
        z-index: 2147483646 !important;
        box-shadow: 0 0 12px rgba(16, 185, 129, 0.4), 0 2px 8px rgba(0, 0, 0, 0.35) !important;
        white-space: nowrap !important;
        border: 1px solid rgba(168, 85, 247, 0.55) !important;
      }

      /* Similar Elements Box — pulsing neon dashed outline */
      .ph-similar-box {
        position: fixed !important;
        border: 1.5px dashed rgba(168, 85, 247, 0.75) !important;
        background-color: rgba(168, 85, 247, 0.06) !important;
        border-radius: 3px !important;
        pointer-events: none !important;
        z-index: 2147483639 !important;
        animation: ph-similar-pulse 2.4s ease-in-out infinite !important;
      }

      @keyframes ph-similar-pulse {
        0%, 100% {
          opacity: 0.55;
          box-shadow: 0 0 6px rgba(168, 85, 247, 0.35);
        }
        50% {
          opacity: 1;
          box-shadow: 0 0 14px rgba(168, 85, 247, 0.8);
        }
      }

      /* Floating Interactive Toolbar */
      .ph-toolbar {
        position: fixed !important;
        top: 20px !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        min-width: 480px !important;
        max-width: 90vw !important;
        background: rgba(15, 23, 42, 0.94) !important;
        backdrop-filter: blur(8px) !important;
        -webkit-backdrop-filter: blur(8px) !important;
        border: 1px solid rgba(255, 255, 255, 0.15) !important;
        border-radius: 10px !important;
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.05) !important;
        padding: 12px 16px !important;
        pointer-events: auto !important;
        z-index: 2147483647 !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 10px !important;
        color: #f8fafc !important;
        animation: ph-slide-down 0.2s ease-out !important;
      }

      @keyframes ph-slide-down {
        from { opacity: 0; transform: translate(-50%, -10px); }
        to { opacity: 1; transform: translate(-50%, 0); }
      }

      .ph-toolbar-header {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
      }

      .ph-toolbar-title {
        font-size: 13px !important;
        font-weight: 500 !important;
        color: #cbd5e1 !important;
      }

      .ph-toolbar-title strong {
        color: #38bdf8 !important;
        font-weight: 700 !important;
      }

      .ph-warning-pill {
        background: #78350f !important;
        color: #fef3c7 !important;
        font-size: 10px !important;
        padding: 2px 6px !important;
        border-radius: 4px !important;
        font-weight: 600 !important;
      }

      .ph-toolbar-details {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
      }

      .ph-selector-code {
        background: #020617 !important;
        color: #e2e8f0 !important;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
        font-size: 12px !important;
        padding: 4px 8px !important;
        border-radius: 4px !important;
        border: 1px solid #334155 !important;
        max-width: 380px !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        flex: 1 !important;
      }

      .ph-match-badge {
        background: #1e293b !important;
        color: #94a3b8 !important;
        font-size: 11px !important;
        font-weight: 600 !important;
        padding: 3px 8px !important;
        border-radius: 4px !important;
        white-space: nowrap !important;
      }

      .ph-breadcrumb-bar {
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        font-size: 11px !important;
        color: #94a3b8 !important;
        overflow-x: auto !important;
        padding-bottom: 2px !important;
      }

      .ph-breadcrumb-label {
        font-weight: 600 !important;
        white-space: nowrap !important;
      }

      .ph-breadcrumb-trail {
        display: flex !important;
        align-items: center !important;
        gap: 4px !important;
        flex-wrap: nowrap !important;
      }

      .ph-breadcrumb-separator {
        color: #475569 !important;
      }

      .ph-breadcrumb-item {
        background: transparent !important;
        color: #93c5fd !important;
        border: none !important;
        font-size: 11px !important;
        cursor: pointer !important;
        padding: 2px 4px !important;
        border-radius: 3px !important;
        text-decoration: underline !important;
        white-space: nowrap !important;
        transition: background 0.15s !important;
      }

      .ph-breadcrumb-item:hover {
        background: rgba(59, 130, 246, 0.2) !important;
        color: #bfdbfe !important;
      }

      .ph-breadcrumb-item.ph-active {
        color: #34d399 !important;
        font-weight: 700 !important;
        text-decoration: none !important;
      }

      .ph-toolbar-actions {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        margin-top: 4px !important;
      }

      .ph-toolbar-actions-right {
        display: flex !important;
        gap: 8px !important;
      }

      .ph-btn {
        padding: 6px 12px !important;
        font-size: 12px !important;
        font-weight: 600 !important;
        border-radius: 6px !important;
        cursor: pointer !important;
        border: none !important;
        transition: all 0.15s ease !important;
      }

      .ph-btn-primary {
        background-color: #10b981 !important;
        color: #ffffff !important;
      }

      .ph-btn-primary:hover {
        background-color: #059669 !important;
      }

      .ph-btn-secondary {
        background-color: #334155 !important;
        color: #f1f5f9 !important;
      }

      .ph-btn-secondary:hover:not(:disabled) {
        background-color: #475569 !important;
      }

      .ph-btn-secondary:disabled {
        opacity: 0.4 !important;
        cursor: not-allowed !important;
      }

      .ph-btn-cancel {
        background-color: transparent !important;
        color: #ef4444 !important;
        border: 1px solid rgba(239, 68, 68, 0.4) !important;
      }

      .ph-btn-cancel:hover {
        background-color: rgba(239, 68, 68, 0.1) !important;
        border-color: #ef4444 !important;
      }
    `;
  }
}
