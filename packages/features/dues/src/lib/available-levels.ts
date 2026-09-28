import type { DuesLevel, MemberDuesSummary } from '../types';

/**
 * The dues levels a member may buy online -- the one rule shared by the
 * checkout dropdown and `createPaymentAction`, so the form never offers a
 * level the server would refuse.
 *
 * - No member record: nothing (the sign-in cannot pay dues).
 * - The FS assigned a non-self-service level (public_service, honorary, or
 *   student): only that level.
 * - Otherwise: the self-service levels, plus student when `is_student`.
 *
 * `levels` must be the ACTIVE levels (`DuesService.levels()`). Every level
 * returned here also passes `kit.record_online_dues_period`'s own check
 * (active AND (self_service OR slug = members.dues_level OR (student AND
 * is_student))), which is looser -- so a payment the action accepts is
 * never one the trigger rejects.
 */
export function availableDuesLevels(
  levels: DuesLevel[],
  mine: MemberDuesSummary | null,
): DuesLevel[] {
  if (!mine) {
    return [];
  }

  const assigned = levels.find((level) => level.slug === mine.duesLevel);

  if (assigned && !assigned.selfService) {
    return [assigned];
  }

  return levels.filter(
    (level) =>
      level.selfService || (level.slug === 'student' && mine.isStudent),
  );
}
