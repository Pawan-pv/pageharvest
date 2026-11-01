/**
 * Interactive Element Picker Controller
 * Coordinates mouse inspection, selection state machine, breadcrumb navigation,
 * dynamic mutation observation, keyboard shortcuts, and isolated overlay rendering.
 */

import { PickerOverlay } from './overlay';
import {
  generateBestSelector,
  generateSelectorCandidates,
  filterSemanticClasses
} from './selector-engine';
import { assessTargetElementFrame } from './frame-assessor';
import {
  ElementBreadcrumb,
  ElementRect,
  HoverElementInfo,
  PickerMode,
  PickerOptions,
  SelectedElementInfo
} from './types';

export class ElementPicker {
  private mode: PickerMode = 'inactive';
  private options: PickerOptions;
  private overlay: PickerOverlay;

  private currentHoverElement: Element | null = null;
  private selectedElement: Element | null = null;
  private selectedInfo: SelectedElementInfo | null = null;

  // Observers & Listeners
  private mutationObserver: MutationObserver | null = null;
  private boundOnMouseMove: (e: MouseEvent) => void;
  private boundOnClick: (e: MouseEvent) => void;
  private boundOnKeyDown: (e: KeyboardEvent) => void;
  private boundOnScroll: () => void;
  private boundOnResize: () => void;

  constructor(options: PickerOptions = {}) {
    this.options = { ...options };
    this.overlay = new PickerOverlay(this.options);

    // Bind event handlers
    this.boundOnMouseMove = this.handleMouseMove.bind(this);
    this.boundOnClick = this.handleClick.bind(this);
    this.boundOnKeyDown = this.handleKeyDown.bind(this);
    this.boundOnScroll = this.handleViewportChange.bind(this);
    this.boundOnResize = this.handleViewportChange.bind(this);
  }

  /**
   * Starts interactive selection mode.
   */
  public start(): void {
    if (this.mode !== 'inactive') return;

    this.mode = 'inspecting';

    // 1. Attach overlay to document
    this.overlay.attach({
      onParent: () => this.selectParent(),
      onBreadcrumb: (bc) => this.selectElement(bc.element),
      onConfirm: () => this.confirm(),
      onCancel: () => this.cancel()
    });

    // 2. Attach global event listeners in capture phase
    window.addEventListener('mousemove', this.boundOnMouseMove, { capture: true, passive: true });
    window.addEventListener('click', this.boundOnClick, { capture: true, passive: false });
    window.addEventListener('keydown', this.boundOnKeyDown, { capture: true, passive: false });
    window.addEventListener('scroll', this.boundOnScroll, { capture: true, passive: true });
    window.addEventListener('resize', this.boundOnResize, { capture: true, passive: true });

    // 3. Attach MutationObserver to react to dynamic DOM changes
    this.setupMutationObserver();
  }

  /**
   * Stops the picker, removes all listeners and completely cleans up the DOM.
   */
  public stop(): void {
    if (this.mode === 'inactive') return;

    this.mode = 'inactive';
    this.currentHoverElement = null;
    this.selectedElement = null;
    this.selectedInfo = null;

    // 1. Remove event listeners
    window.removeEventListener('mousemove', this.boundOnMouseMove, { capture: true });
    window.removeEventListener('click', this.boundOnClick, { capture: true });
    window.removeEventListener('keydown', this.boundOnKeyDown, { capture: true });
    window.removeEventListener('scroll', this.boundOnScroll, { capture: true });
    window.removeEventListener('resize', this.boundOnResize, { capture: true });

    // 2. Disconnect mutation observer
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }

    // 3. Destroy overlay
    this.overlay.destroy();
  }

  /**
   * Returns current picker mode.
   */
  public getMode(): PickerMode {
    return this.mode;
  }

  /**
   * Returns information about the currently selected element, or null.
   */
  public getSelectedInfo(): SelectedElementInfo | null {
    return this.selectedInfo;
  }

  /**
   * Selects an element programmatically or via user click.
   */
  public selectElement(target: Element): void {
    if (!target || !(target instanceof Element)) return;
    if (this.overlay.isPickerElement(target)) return;

    this.selectedElement = target;
    this.mode = 'selected';

    // Clear hover box
    this.overlay.updateHover(null);

    // Compute element metadata
    const info = this.inspectElement(target);
    this.selectedInfo = info;

    // Update overlay UI
    this.overlay.updateSelection(info);

    // Trigger select callback
    if (this.options.onSelect) {
      this.options.onSelect(info);
    }
  }

  /**
   * Selects the parent element of the currently selected element (parent/container discovery).
   */
  public selectParent(): void {
    if (!this.selectedElement) return;

    const parent = this.selectedElement.parentElement;
    if (parent && parent !== document.documentElement && !this.overlay.isPickerElement(parent)) {
      this.selectElement(parent);
    }
  }

  /**
   * Confirms the current selection and stops the picker.
   */
  public confirm(): void {
    if (this.selectedInfo) {
      if (this.options.onConfirm) {
        this.options.onConfirm(this.selectedInfo);
      }
    }
    this.stop();
  }

  /**
   * Cancels the selection and stops the picker.
   */
  public cancel(): void {
    if (this.options.onCancel) {
      this.options.onCancel();
    }
    this.stop();
  }

  /**
   * Handles mouse movement over the web page.
   */
  private handleMouseMove(e: MouseEvent): void {
    if (this.mode !== 'inspecting') return;

    const target = e.target as Element | null;
    if (!target || !(target instanceof Element)) {
      this.currentHoverElement = null;
      this.overlay.updateHover(null);
      return;
    }

    // Ignore overlay elements
    if (this.overlay.isPickerElement(target)) {
      return;
    }

    // If still over the same element, skip recalculation
    if (target === this.currentHoverElement) {
      return;
    }

    this.currentHoverElement = target;

    const rect = this.toElementRect(target.getBoundingClientRect());
    const selector = generateBestSelector(target);
    const tagName = target.tagName.toLowerCase();
    const classList = filterSemanticClasses(target.classList);

    const hoverInfo: HoverElementInfo = {
      element: target,
      selector,
      tagName,
      classList,
      rect
    };

    this.overlay.updateHover(hoverInfo);

    if (this.options.onHover) {
      this.options.onHover(hoverInfo);
    }
  }

  /**
   * Handles clicks in the document.
   */
  private handleClick(e: MouseEvent): void {
    if (this.mode === 'inactive') return;

    const target = e.target as Element | null;
    if (!target || !(target instanceof Element)) return;

    // Allow user to interact with the picker toolbar
    if (this.overlay.isPickerElement(target)) {
      return;
    }

    // Intercept host page click so links/forms are not triggered
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    this.selectElement(target);
  }

  /**
   * Handles keyboard shortcuts for accessibility and quick navigation.
   */
  private handleKeyDown(e: KeyboardEvent): void {
    if (this.mode === 'inactive') return;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.cancel();
      return;
    }

    if (e.key === 'Enter' && this.mode === 'selected') {
      e.preventDefault();
      e.stopPropagation();
      this.confirm();
      return;
    }

    if (e.key === 'ArrowUp' && this.mode === 'selected') {
      e.preventDefault();
      e.stopPropagation();
      this.selectParent();
      return;
    }
  }

  /**
   * Updates positions when window is scrolled or resized.
   */
  private handleViewportChange(): void {
    if (this.mode === 'selected' && this.selectedElement) {
      if (this.selectedElement.isConnected) {
        const rect = this.toElementRect(this.selectedElement.getBoundingClientRect());
        if (this.selectedInfo) {
          this.selectedInfo.rect = rect;
          this.overlay.updateSelection(this.selectedInfo);
        }
      }
    } else if (this.mode === 'inspecting' && this.currentHoverElement) {
      if (this.currentHoverElement.isConnected) {
        const rect = this.toElementRect(this.currentHoverElement.getBoundingClientRect());
        const selector = generateBestSelector(this.currentHoverElement);
        const tagName = this.currentHoverElement.tagName.toLowerCase();
        const classList = filterSemanticClasses(this.currentHoverElement.classList);
        this.overlay.updateHover({
          element: this.currentHoverElement,
          selector,
          tagName,
          classList,
          rect
        });
      }
    }
  }

  /**
   * Sets up a MutationObserver to react to dynamic DOM changes.
   */
  private setupMutationObserver(): void {
    if (typeof MutationObserver === 'undefined') return;

    this.mutationObserver = new MutationObserver(() => {
      if (this.mode === 'selected' && this.selectedElement) {
        if (!this.selectedElement.isConnected) {
          // Element was removed from document
          this.cancel();
          return;
        }

        // Re-calculate matches count and similar highlights
        if (this.selectedInfo) {
          try {
            const queryTarget = this.selectedInfo.similarSelector || this.selectedInfo.selector;
            const matches = document.querySelectorAll(queryTarget);
            this.selectedInfo.matchCount = matches.length;
            this.overlay.updateSelection(this.selectedInfo);
          } catch {
            // Ignore query error
          }
        }
      }
    });

    this.mutationObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'id']
    });
  }

  /**
   * Inspects a DOM element safely and constructs its metadata.
   */
  private inspectElement(element: Element): SelectedElementInfo {
    const selector = generateBestSelector(element);
    const tagName = element.tagName.toLowerCase();
    const id = element.id || undefined;
    const classList = filterSemanticClasses(element.classList);
    const textSnippet = this.extractTextSnippet(element);
    const attributes = this.extractAttributes(element);
    const rect = this.toElementRect(element.getBoundingClientRect());
    const breadcrumbs = this.buildBreadcrumbTrail(element);
    const selectorCandidates = generateSelectorCandidates(element);
    const crossFrame = assessTargetElementFrame(element);

    // Identify similar / repeated pattern selector
    const similarCandidate = selectorCandidates.find(
      (c) => c.matchCount > 1 && (c.strategy === 'semantic-class' || c.strategy === 'semantic-attribute' || c.strategy === 'hierarchy')
    );
    const similarSelector = similarCandidate ? similarCandidate.selector : undefined;

    let matchCount = similarCandidate ? similarCandidate.matchCount : 1;
    if (!similarCandidate) {
      try {
        matchCount = document.querySelectorAll(selector).length;
      } catch {
        matchCount = 1;
      }
    }

    return {
      element,
      selector,
      similarSelector,
      tagName,
      id,
      classList,
      textSnippet,
      attributes,
      rect,
      breadcrumbs,
      selectorCandidates,
      matchCount,
      crossFrame
    };
  }

  /**
   * Extracts a concise text snippet for preview.
   */
  private extractTextSnippet(element: Element): string {
    const raw = element.textContent || '';
    const cleaned = raw.replace(/\s+/g, ' ').trim();
    return cleaned.length > 80 ? `${cleaned.slice(0, 77)}...` : cleaned;
  }

  /**
   * Extracts HTML attributes as key-value pairs safely.
   */
  private extractAttributes(element: Element): Record<string, string> {
    const result: Record<string, string> = {};
    for (let i = 0; i < element.attributes.length; i++) {
      const attr = element.attributes[i];
      if (!attr.name.startsWith('data-pageharvest-')) {
        result[attr.name] = attr.value;
      }
    }
    return result;
  }

  /**
   * Builds the breadcrumb trail from document.body down to the element.
   */
  private buildBreadcrumbTrail(element: Element): ElementBreadcrumb[] {
    const trail: ElementBreadcrumb[] = [];
    let current: Element | null = element;

    while (current && current !== document.documentElement) {
      if (this.overlay.isPickerElement(current)) {
        current = current.parentElement;
        continue;
      }

      const tagName = current.tagName.toLowerCase();
      const meaningful = filterSemanticClasses(current.classList);
      let label = tagName;
      if (current.id) {
        label += `#${current.id.slice(0, 12)}`;
      } else if (meaningful.length > 0) {
        label += `.${meaningful[0]}`;
      }

      const selector = generateBestSelector(current);
      const isContainer = ['div', 'ul', 'ol', 'table', 'tbody', 'section', 'article', 'main'].includes(
        tagName
      );

      trail.unshift({
        element: current,
        tagName,
        selector,
        label,
        isContainer
      });

      if (current === document.body) break;
      current = current.parentElement;
    }

    return trail;
  }

  private toElementRect(r: DOMRect): ElementRect {
    return {
      top: r.top,
      left: r.left,
      width: r.width,
      height: r.height
    };
  }
}
