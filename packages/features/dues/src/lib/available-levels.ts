import type { DuesLevel, MyDuesSummary } from '../types';

/**
 * The dues levels a member may buy online -- the one rule shared by the
 * checkout dropdown and `createPaymentAction`, so the form never offers a
 * level the server would refuse.
 *
 * - No member record: nothing (the sign-in cannot pay dues).
 * - The FS assigned a non-self-service level (public_service, honorary, or
 *   student): only that level -- or nothing if it has been deactivated, so
 *   the member is sent to the FS rather than offered a self-service price.
 * - Otherwise: the self-service levels, plus student when `is_student`
 *   (this includes an assigned self-service level that was deactivated).
 *
 * `levels` must be the ACTIVE levels (`DuesService.levels()`). Every level
 * returned here also passes `kit.record_online_dues_period`'s own check
 * (active AND (self_service OR slug = members.dues_level OR (student AND
 * is_student)), judged on the level's active flag and price as of the
 * payment's creation), which is looser -- so a payment the action accepts is
 * never one the trigger rejects.
 */
export function availableDuesLevels(
  levels: DuesLevel[],
  mine: MyDuesSummary | null,
): DuesLevel[] {
  if (!mine) {
    return [];
  }

  if (!mine.levelSelfService) {
    const assigned = mine.levelActive
      ? levels.find((level) => level.slug === mine.duesLevel)
      : undefined;

    return assigned ? [assigned] : [];
  }

  return levels.filter(
    (level) =>
      level.selfService || (level.slug === 'student' && mine.isStudent),
  );
}
