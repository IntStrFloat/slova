import { track } from '@/features/analytics';

/** Fixed element IDs only: labels can contain user data or dynamic copy. */
export function trackRetentionAction(screen: string, elementId: string, properties: Record<string, unknown> = {}): string {
  const interactionId = typeof properties.interaction_id === 'string' ? properties.interaction_id
    : `ui:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
  try {
    track('ui_action', { screen, element_id: elementId, action: 'tap', outcome: 'accepted',
      ...properties, interaction_id: interactionId });
  } catch { /* UI actions never depend on telemetry availability. */ }
  return interactionId;
}
