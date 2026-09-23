'use client';

import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import { alertExtras } from '@kit/ui/alert-extras';
import { If } from '@kit/ui/if';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';
import { cn } from '@kit/ui/utils';

import { needsAccountReassignment } from './apply-loop';
import type { ApplyOutcome } from './apply-loop';

/** `1 member`, `2 members`. A report that says "1 members" reads as a bug. */
export function quantify(
  value: number,
  singular: string,
  plural = `${singular}s`,
) {
  return `${value} ${value === 1 ? singular : plural}`;
}

/** How the toast that announces a finished run should look and read. */
export interface OutcomeNotice {
  tone: 'success' | 'warning' | 'error';
  message: string;
}

/**
 * The one-line version of an outcome, for the toast.
 *
 * It lives beside the alert that renders the same outcome, and deliberately so.
 * The first version of this screen branched the ALERT on `failures.length` and
 * the toast on `status` alone, and the two disagreed: a run where a member
 * tripped the one-account-per-member constraint showed an amber "1 could not be
 * applied" alert while a green toast said "Imported 2 rows" and never mentioned
 * the failure. The toast is the coloured thing that draws the eye, and the only
 * part of the outcome still on screen if the officer has scrolled -- so it is
 * the one that decides whether they close the tab believing all is well.
 *
 * `status === 'complete'` means the loop reached the end of the plan. It does
 * NOT mean every row landed, and nothing that speaks to a human may treat the
 * two as the same thing.
 */
export function describeOutcome(
  outcome: ApplyOutcome,
  filename: string,
): OutcomeNotice {
  if (outcome.status !== 'complete') {
    return {
      tone: 'error',
      // The action's own sentence. On the applied-but-unrecorded path it says
      // the members landed and a re-run is safe; nothing here can improve on
      // that, and "the import failed" would contradict it.
      message: outcome.error ?? 'The import stopped before it finished.',
    };
  }

  const imported = `Imported ${quantify(outcome.applied, 'row')} from ${filename}.`;

  if (outcome.failures.length === 0) {
    return { tone: 'success', message: imported };
  }

  return {
    tone: 'warning',
    message: `${imported} ${quantify(outcome.failures.length, 'row')} could not be applied.`,
  };
}

/**
 * What happened when the officer pressed apply.
 *
 * Its own module because it is the part of the screen that has to keep three
 * outcomes apart -- refused, broken, finished -- and because keeping it
 * independently renderable is what lets a test pin that separation. A denied
 * officer told "the import stopped" goes looking at their spreadsheet for a
 * problem that is not in it.
 */
export function RosterImportOutcome({
  outcome,
  scroller,
  wrap,
}: {
  outcome: ApplyOutcome;
  /** The preview's shared table scroller classes. */
  scroller: string;
  /** The preview's shared cell-wrapping classes. */
  wrap: string;
}) {
  const recurringFailures = outcome.failures.filter(needsAccountReassignment);

  const otherFailures = outcome.failures.filter(
    (failure) => !needsAccountReassignment(failure),
  );

  return (
    <div className="flex flex-col gap-y-4">
      {/*
        A withdrawn grant and a broken run are both `success: false`, and they
        ask for opposite things. This one is "ask for your role back"; sending
        the officer to audit the spreadsheet instead costs them an afternoon
        and fixes nothing.
      */}
      <If condition={outcome.status === 'denied'}>
        <Alert variant="destructive" data-test="roster-denied">
          <AlertTitle>Your permission to import was withdrawn</AlertTitle>

          <AlertDescription>
            <p>{outcome.error}</p>

            <p>
              There is nothing wrong with the spreadsheet. Ask an administrator
              to restore your permission to manage members, then run the import
              again.
            </p>

            {/*
              Only when something landed. "0 rows were written and they are
              already saved" is noise on the run that never started, and the
              officer reading this one needs the count, not the reassurance.
            */}
            <If condition={outcome.applied > 0}>
              <p>
                {quantify(outcome.applied, 'row')} had already been written
                before this happened, and{' '}
                {outcome.applied === 1 ? 'it is' : 'they are'} saved. Running
                the import again once your permission is back is safe.
              </p>
            </If>
          </AlertDescription>
        </Alert>
      </If>

      {/*
        The action's own sentence, unedited. When the write succeeded and only
        the record-keeping failed, that sentence says the members landed and a
        re-run is safe -- which is exactly what a summary word like "failed"
        would destroy.
      */}
      <If condition={outcome.status === 'halted'}>
        <Alert variant="destructive" data-test="roster-halted">
          <AlertTitle>The import stopped before it finished</AlertTitle>

          <AlertDescription>
            <p>{outcome.error}</p>

            <p>No further rows were sent.</p>
          </AlertDescription>
        </Alert>
      </If>

      {/*
        Green only when every row landed. A run that finished with members
        missing is not a success an officer should be able to skim past.
      */}
      <If condition={outcome.status === 'complete'}>
        <Alert
          className={
            outcome.failures.length > 0
              ? alertExtras.warning
              : alertExtras.success
          }
          data-test="roster-complete"
        >
          <AlertTitle>Import finished</AlertTitle>

          <AlertDescription>
            {quantify(outcome.applied, 'row')} written
            {outcome.failures.length > 0
              ? `, ${outcome.failures.length} could not be applied.`
              : '.'}
          </AlertDescription>
        </Alert>
      </If>

      {/*
        These rows fail identically on every future import, so they cannot be
        left in a list a monthly reader has learned to skim. Somebody has to
        reassign the account by hand; until they do, this import and the next
        one and the one after report the same members.
      */}
      <If condition={recurringFailures.length > 0}>
        <Alert
          className={alertExtras.warning}
          data-test="roster-recurring-failures"
        >
          <AlertTitle>
            {quantify(recurringFailures.length, 'member')}{' '}
            {recurringFailures.length === 1 ? 'needs' : 'need'} their account
            reassigned by hand
          </AlertTitle>

          <AlertDescription>
            <p>
              The sign-in account for each address below already belongs to a
              different member, and one member may hold only one account.
              Re-running the import will not clear these — they will fail the
              same way every month until an administrator moves the account to
              the right member.
            </p>

            <ul className="list-disc pl-5">
              {recurringFailures.map((failure) => (
                <li key={failure.membershipNumber}>
                  Member {failure.membershipNumber}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      </If>

      <If condition={otherFailures.length > 0}>
        <div className={scroller} data-test="roster-failures">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>What went wrong</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {otherFailures.map((failure, index) => (
                <TableRow
                  key={`${failure.membershipNumber}-${index}`}
                  data-test="roster-failure-row"
                >
                  <TableCell>{failure.membershipNumber}</TableCell>
                  <TableCell className={cn('text-muted-foreground', wrap)}>
                    {failure.error}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </If>
    </div>
  );
}
