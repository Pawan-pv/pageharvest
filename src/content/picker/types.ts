/**
 * Interactive Element Picker - Domain Types & Interfaces
 */

export type PickerMode = 'inactive' | 'inspecting' | 'selected';

export type SelectorStrategy =
  | 'id'
  | 'test-attribute'
  | 'semantic-attribute'
  | 'semantic-class'
  | 'hierarchy'
  | 'relative'
  | 'fallback'
  | 'xpath';

export interface SelectorCandidate {
  selector: string;
  strategy: SelectorStrategy;
  specificity: number;
  isUnique: boolean;
  matchCount: number;
  confidence: number; // 0 to 1
}

export interface ElementBreadcrumb {
  element: Element;
  tagName: string;
  selector: string;
  label: string;
  isContainer: boolean;
}

export interface CrossFrameAssessment {
  isIframe: boolean;
  isCrossOrigin: boolean;
  frameDepth: number;
  isSandboxed: boolean;
  warning?: string;
}

export interface ElementRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface SelectedElementInfo {
  element: Element;
  selector: string;
  similarSelector?: string;
  tagName: string;
  id?: string;
  classList: string[];
  textSnippet: string;
  attributes: Record<string, string>;
  rect: ElementRect;
  breadcrumbs: ElementBreadcrumb[];
  selectorCandidates: SelectorCandidate[];
  matchCount: number;
  crossFrame: CrossFrameAssessment;
}

export interface HoverElementInfo {
  element: Element;
  selector: string;
  tagName: string;
  classList: string[];
  rect: ElementRect;
}

export interface PickerOptions {
  highlightColor?: string;
  selectedColor?: string;
  similarColor?: string;
  showToolbar?: boolean;
  showSimilar?: boolean;
  onHover?: (info: HoverElementInfo | null) => void;
  onSelect?: (info: SelectedElementInfo) => void;
  onConfirm?: (info: SelectedElementInfo) => void;
  onCancel?: () => void;
}
