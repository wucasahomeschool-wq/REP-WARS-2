import { EventDefinition, ConditionContext, EventSeverity } from './EventModel';
export declare const EVENT_REGISTRY: Record<string, EventDefinition>;
export declare const EVENT_LIST: EventDefinition[];
export declare function getEventById(id: string): EventDefinition | undefined;
type TriggerInfo = {
    eventId: string;
    weight: number;
    severityHint?: EventSeverity;
    reasons: string[];
};
export declare function evaluateAllTriggersForTerritory(ctx: ConditionContext): TriggerInfo[];
export {};
