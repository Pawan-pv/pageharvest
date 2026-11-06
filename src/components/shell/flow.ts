import type { WorkflowView } from '@/hooks/useExtractionWorkflow';
import type { StepperStep } from '@/components/common/Stepper';

/** How the user started: the first step is named after it. */
export type FlowKind = 'pick' | 'auto' | 'table' | 'links' | 'recipe';
export type FlowStepId = 'pick' | 'fields' | 'pagination' | 'run' | 'export';

const FIRST_STEP: Record<FlowKind, string> = {
  pick: 'Pick data',
  auto: 'Find data',
  table: 'Find a table',
  links: 'Find links',
  recipe: 'Load recipe',
};

/**
 * Every flow on this build reaches the same five steps: the Table and Links presets run
 * detection, then the same field, pagination, run and export screens. Only the first step
 * differs, so it is renamed rather than hidden.
 */
export function flowSteps(kind: FlowKind): StepperStep[] {
  return [
    { id: 'pick', label: FIRST_STEP[kind] },
    { id: 'fields', label: 'Review fields' },
    { id: 'pagination', label: 'Pagination', optional: true },
    { id: 'run', label: 'Run' },
    { id: 'export', label: 'Export' },
  ];
}

/** The step a panel view belongs to, or null for views outside the flow. */
export function stepForView(view: WorkflowView): FlowStepId | null {
  switch (view) {
    case 'inspecting':
    case 'review_list':
      return 'pick';
    case 'config_fields':
      return 'fields';
    case 'extracting':
      return 'run';
    case 'results':
      return 'export';
    default:
      return null;
  }
}
