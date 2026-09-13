import { FrequencyEvidence, RegroupingEvidence } from './types';

export function buildFrequencyEvidence(): FrequencyEvidence {
  return {
    source: 'FREQUENCY',
    quality: 'UNAVAILABLE',
    reason: 'history_not_in_scope',
  };
}

export function buildRegroupingEvidence(): RegroupingEvidence {
  return {
    source: 'REGROUPING',
    quality: 'UNAVAILABLE',
    reason: 'regrouping_not_in_scope',
  };
}
