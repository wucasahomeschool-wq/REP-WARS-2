import { workoutDifficultyRank } from '../difficulty';
import { CompletedWorkoutRecord } from '../session/types';
import {
  FEEDBACK_RELATIVE_OFFSET,
  PerceivedDifficultyEvidence,
  RelativeDifficultyReading,
} from './types';

function readingFor(offset: number): RelativeDifficultyReading {
  if (offset < 0) return 'EASIER_THAN_INTENDED';
  if (offset > 0) return 'HARDER_THAN_INTENDED';
  return 'AS_INTENDED';
}

export function buildPerceivedDifficultyEvidence(record: CompletedWorkoutRecord): PerceivedDifficultyEvidence {
  const feedback = record.feedback!;
  const relativeOffset = FEEDBACK_RELATIVE_OFFSET[feedback.value];
  return {
    source: 'PERCEIVED_DIFFICULTY',
    quality: 'STRONG',
    intendedDifficulty: record.intendedDifficulty,
    intendedDifficultyRank: workoutDifficultyRank(record.intendedDifficulty),
    perceivedRelative: feedback.value,
    relativeOffset,
    reading: readingFor(relativeOffset),
  };
}
