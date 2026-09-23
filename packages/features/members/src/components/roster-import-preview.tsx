'use client';

import { useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import { alertExtras } from '@kit/ui/alert-extras';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@kit/ui/collapsible';
import { If } from '@kit/ui/if';
import { Progress } from '@kit/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';
import { toast } from '@kit/ui/sonner';
import { cn } from '@kit/ui/utils';

import { applyRosterChunkAction } from '../server/roster-actions';
import type { PreviewPlan } from '../server/roster-actions';
import type { PlanRow } from '../server/roster-plan';
import { needsAccountReassignment, runApplyLoop } from './apply-loop';
import type { ApplyOutcome, ApplyProgress } from './apply-loop';
import { CONFLICT_LABELS, summarizePlan } from './plan-summary';

function sourceRowLabel(row: { sourceRow?: number }) {
  return row.sourceRow === undefined ? '—' : String(row.sourceRow);
}

/**
 * A long table is scrolled rather than allowed to bury the button below it,
 * and a wide one scrolls sideways rather than having its last column clipped
 * by the card -- the last column is where "that address belongs to another
 * member" is written.
 */
const SCROLLER = 'max-h-96 overflow-auto rounded-lg border';

/**
 * The table primitive sets `whitespace-nowrap` on every cell, which makes a
 * six-column table wider than the card and pushes its LAST column out of
 * sight. The last column is where "that address belongs to another member" is
 * written, so the long columns are allowed to wrap instead.
 */
const WRAP = 'whitespace-normal break-words';

/** `1 member`, `2 members`. A report that says "1 members" reads as a bug. */
function quantify(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function Count({
  label,
  value,
  name,
  muted = false,
}: {
  label: string;
  value: number;
  name: string;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col gap-y-1" data-test={`roster-count-${name}`}>
      <span
        className={
          muted
            ? 'text-muted-foreground text-2xl font-semibold'
            : 'text-foreground text-2xl font-semibold'
        }
      >
        {value}
      </span>
      <span className="text-muted-foreground text-sm">{label}</span>
    </div>
  );
}

export function RosterImportPreview({
  importId,
  filename,
  plan,
  onStartOver,
}: {
  importId: string;
  filename: string;
  plan: PreviewPlan;
  onStartOver: () => void;
}) {
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<ApplyProgress | null>(null);
  const [outcome, setOutcome] = useState<ApplyOutcome | null>(null);

  const summary = summarizePlan(plan);
  const totalRows = plan.rows.length;

  const onConfirm = async () => {
    if (applying) return;

    setApplying(true);
    setOutcome(null);
    setProgress({ examined: 0, applied: 0 });

    // Mirrored outside React state so the catch below can still say how many
    // members landed; a `setState` written a moment ago is not readable here.
    let latest: ApplyProgress = { examined: 0, applied: 0 };

    try {
      const result = await runApplyLoop(
        totalRows,
        (offset) => applyRosterChunkAction({ importId, offset }),
        (next) => {
          latest = next;
          setProgress(next);
        },
      );

      setOutcome(result);

      if (result.status === 'complete') {
        toast.success(`Imported ${result.applied} rows from ${filename}.`);
      } else {
        toast.error(result.error ?? 'The import stopped.');
      }
    } catch (cause) {
      // Every expected failure is RETURNED by the action, so reaching here
      // means something outside it broke -- the network, or a Server Action
      // whose message Next.js has redacted. Reported as its own outcome rather
      // than left as an unhandled rejection with a spinner running forever.
      setOutcome({
        status: 'halted',
        applied: latest.applied,
        failures: [],
        error:
          cause instanceof Error && cause.message !== ''
            ? cause.message
            : 'The import could not be reached. Nothing further was sent.',
      });

      toast.error('The import could not be reached.');
    } finally {
      setApplying(false);
    }
  };

  const recurringFailures = (outcome?.failures ?? []).filter(
    needsAccountReassignment,
  );

  const otherFailures = (outcome?.failures ?? []).filter(
    (failure) => !needsAccountReassignment(failure),
  );

  return (
    <div className="flex flex-col gap-y-6" data-test="roster-preview">
      <Card>
        <CardHeader>
          <CardTitle>What this import will do</CardTitle>

          <CardDescription>
            Nothing has been written yet. {filename} —{' '}
            {quantify(totalRows, 'row')} read.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-wrap gap-x-12 gap-y-4">
          <Count name="create" label="New members" value={plan.counts.create} />
          <Count name="update" label="Updated" value={plan.counts.update} />
          <Count
            name="nochange"
            label="No change"
            value={plan.counts.nochange}
            muted
          />
          <Count name="skip" label="Skipped rows" value={plan.counts.skip} />
          <Count
            name="accounts"
            label="Given a sign-in account"
            value={summary.newAccounts}
          />
        </CardContent>
      </Card>

      {/*
        First on the page, and never collapsed. The planner could not tell
        which member really owns this address, so it applied a tie-break it
        says outright it cannot verify -- and at go-live the address IS the
        sign-in identity. The officer knows which of the two transferred out;
        this is the only moment that knowledge can reach the decision.
      */}
      <If condition={summary.awarded.length > 0}>
        <Card data-test="roster-awarded-emails">
          <CardHeader>
            <CardTitle className="text-destructive">
              Check these email addresses before you import
            </CardTitle>

            <CardDescription>
              Two membership numbers claimed the same address and the file does
              not say which is right. Each address below was awarded to one of
              them by a rule that guesses — and the guess can be wrong. After
              go-live the address is how a member signs in, so awarding it to
              the wrong person gives them the other member&apos;s account. If a
              line below is wrong, correct the spreadsheet and upload it again.
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-y-3">
            {summary.awarded.map((entry, index) => (
              <Alert
                key={`${entry.row.membershipNumber}-${index}`}
                variant="destructive"
                data-test="roster-awarded-email"
              >
                <AlertTitle>
                  {entry.conflict.incoming} → member{' '}
                  {entry.row.membershipNumber} ({entry.row.displayName})
                </AlertTitle>

                <AlertDescription>
                  Row {sourceRowLabel(entry.row)} in the file.{' '}
                  {entry.conflict.stored}
                </AlertDescription>
              </Alert>
            ))}
          </CardContent>
        </Card>
      </If>

      {/*
        Members nobody imports. Distinct from the skip count on purpose: a
        skipped repeat listing is harmless because another row imports the
        member anyway, whereas no row here imports these numbers at all -- and
        the export that produced this file will produce the same contest next
        month, so a re-run never resolves it. Correcting the spreadsheet is the
        only thing that does, which makes this a task for a person rather than
        a number in a count.
      */}
      <If condition={summary.blocked.length > 0}>
        <Card data-test="roster-blocked-members">
          <CardHeader>
            <CardTitle>
              {quantify(summary.blocked.length, 'member')} this file cannot
              import
            </CardTitle>

            <CardDescription>
              No row in this file imports these membership numbers. Any of them
              the council does not already hold will stay missing — not now, and
              not on any later import, because every future export has the same
              problem in it. Correct the rows named below in the spreadsheet and
              upload it again.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <div className={SCROLLER}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Rows in the file</TableHead>
                    <TableHead>Why</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {summary.blocked.map((member) => (
                    <TableRow
                      key={member.membershipNumber}
                      data-test="roster-blocked-row"
                    >
                      <TableCell>{member.membershipNumber}</TableCell>
                      <TableCell>{member.displayName}</TableCell>
                      <TableCell>
                        {member.rows.map(sourceRowLabel).join(', ')}
                      </TableCell>
                      <TableCell className={cn('text-muted-foreground', WRAP)}>
                        {[
                          ...new Set(member.rows.map((row) => row.reason)),
                        ].join('; ')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </If>

      {/*
        `value-differs` and `owned-by-another-member`. Few, genuine, and each
        one a decision -- so they are listed one per line, in the open, and not
        folded into the thousands of `already-set` lines below.
      */}
      <If condition={summary.attention.length > 0}>
        <Card data-test="roster-conflicts">
          <CardHeader>
            <CardTitle>
              {quantify(summary.attention.length, 'thing')} to look at before
              importing
            </CardTitle>

            <CardDescription>
              The import will not change any of these by itself. Names and email
              addresses are never overwritten automatically.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <div className={SCROLLER}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Row</TableHead>
                    <TableHead>Member</TableHead>
                    <TableHead>Field</TableHead>
                    <TableHead>In the file</TableHead>
                    <TableHead>On record</TableHead>
                    <TableHead>What it means</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {summary.attention.map((entry, index) => (
                    <TableRow
                      key={`${entry.row.membershipNumber}-${entry.conflict.field}-${index}`}
                      data-test="roster-conflict-row"
                    >
                      <TableCell>{sourceRowLabel(entry.row)}</TableCell>
                      <TableCell>
                        {entry.row.membershipNumber} — {entry.row.displayName}
                      </TableCell>
                      <TableCell>{entry.conflict.field}</TableCell>
                      <TableCell className={WRAP}>
                        {entry.conflict.incoming}
                      </TableCell>
                      <TableCell className={WRAP}>
                        {entry.conflict.stored}
                      </TableCell>
                      <TableCell className={cn('text-muted-foreground', WRAP)}>
                        {CONFLICT_LABELS[entry.conflict.kind]}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </If>

      {/*
        The parser's own rejections. A row that never became a record cannot
        appear anywhere else on this page, so without this it would vanish.
      */}
      <If condition={plan.rowErrors.length > 0}>
        <Card data-test="roster-row-errors">
          <CardHeader>
            <CardTitle>
              {quantify(plan.rowErrors.length, 'row')} could not be read
            </CardTitle>

            <CardDescription>
              These rows are not part of the import at all.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <div className={SCROLLER}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Row</TableHead>
                    <TableHead>Why</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {plan.rowErrors.map((error) => (
                    <TableRow
                      key={`${error.sourceRow}-${error.reason}`}
                      data-test="roster-row-error"
                    >
                      <TableCell>{error.sourceRow}</TableCell>
                      <TableCell className={WRAP}>{error.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </If>

      {/*
        Every skip carries the row number Excel itself shows. "Two rows in the
        file share this email" is unactionable in a 372-row spreadsheet without
        it, and finding the row is the entire task.
      */}
      <If condition={summary.skips.length > 0}>
        <Card data-test="roster-skips">
          <CardHeader>
            <CardTitle>
              {quantify(summary.skips.length, 'row')} will be skipped
            </CardTitle>

            <CardDescription>
              Nothing is written for these rows. The row number is the one shown
              in the spreadsheet.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <div className={SCROLLER}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Row</TableHead>
                    <TableHead>Member</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Why</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {summary.skips.map((row: PlanRow, index) => (
                    <TableRow
                      key={`${row.membershipNumber}-${row.sourceRow ?? index}`}
                      data-test="roster-skip-row"
                    >
                      <TableCell data-test="roster-skip-source-row">
                        {sourceRowLabel(row)}
                      </TableCell>
                      <TableCell>{row.membershipNumber}</TableCell>
                      <TableCell>{row.displayName}</TableCell>
                      <TableCell className={cn('text-muted-foreground', WRAP)}>
                        {row.reason ?? 'Skipped'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </If>

      {/*
        Noise, behind a count. A steady-state re-import of the real roster puts
        thousands of these here while writing nothing at all; inline they would
        bury every line above, and absent altogether an officer reconciling one
        member's address would have nowhere to look.
      */}
      <If condition={summary.alreadySet.length > 0}>
        <AlreadySetDisclosure entries={summary.alreadySet} />
      </If>

      <Card data-test="roster-absent">
        <CardHeader>
          <CardTitle>
            On the roster but not in this file — no action taken
          </CardTitle>

          <CardDescription>
            {plan.absentFromFile.length === 0
              ? 'Every member the council holds appears in this file.'
              : `${quantify(plan.absentFromFile.length, 'member')} ${plan.absentFromFile.length === 1 ? 'is' : 'are'} not in this file. An import never removes or deactivates anybody.`}
          </CardDescription>
        </CardHeader>

        <If condition={plan.absentFromFile.length > 0}>
          <CardContent>
            <p className="text-muted-foreground max-h-40 overflow-y-auto text-sm">
              {plan.absentFromFile.join(', ')}
            </p>
          </CardContent>
        </If>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Apply this import</CardTitle>

          <CardDescription>
            {quantify(summary.writableRows, 'row')} will be written,{' '}
            {summary.newAccounts} of them giving a member a sign-in account.
            Applying the same file twice is safe.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              data-test="roster-confirm"
              disabled={applying}
              onClick={onConfirm}
            >
              {applying
                ? 'Importing…'
                : outcome === null
                  ? 'Import these members'
                  : 'Run the import again'}
            </Button>

            <Button
              variant="outline"
              data-test="roster-start-over"
              disabled={applying}
              onClick={onStartOver}
            >
              Upload a different file
            </Button>
          </div>

          <If condition={progress}>
            {(current) => (
              <div
                className="flex flex-col gap-y-2"
                data-test="roster-progress"
              >
                <Progress
                  value={
                    totalRows === 0
                      ? 100
                      : Math.round((current.examined / totalRows) * 100)
                  }
                />

                <p className="text-muted-foreground text-sm">
                  {current.examined} of {totalRows} rows examined —{' '}
                  {current.applied} written.
                </p>
              </div>
            )}
          </If>

          <If condition={outcome}>
            {(result) => (
              <ApplyOutcomeReport
                outcome={result}
                recurringFailures={recurringFailures}
                otherFailures={otherFailures}
              />
            )}
          </If>
        </CardContent>
      </Card>
    </div>
  );
}

function AlreadySetDisclosure({
  entries,
}: {
  entries: ReturnType<typeof summarizePlan>['alreadySet'];
}) {
  // Controlled rather than `defaultOpen`: the open state is this component's
  // to know, and a default-only control drifts silently from what is on screen.
  const [open, setOpen] = useState(false);

  return (
    <Card data-test="roster-already-set">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader>
          <CardTitle>
            {quantify(entries.length, 'field')} already{' '}
            {entries.length === 1 ? 'has' : 'have'} a value
          </CardTitle>

          <CardDescription>
            An import fills blanks; it never overwrites. Nothing is written for
            any of these, and on a monthly re-import almost every one of them is
            simply the value the council already holds.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-y-4">
          <CollapsibleTrigger
            render={
              <Button
                variant="outline"
                className="self-start"
                data-test="roster-already-set-toggle"
              >
                {open
                  ? 'Hide these'
                  : `Show all ${entries.length} — usually nothing to do`}
              </Button>
            }
          />

          <CollapsibleContent>
            <div className={SCROLLER}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Row</TableHead>
                    <TableHead>Member</TableHead>
                    <TableHead>Field</TableHead>
                    <TableHead>In the file</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {entries.map((entry, index) => (
                    <TableRow
                      key={`${entry.row.membershipNumber}-${entry.conflict.field}-${index}`}
                      data-test="roster-already-set-row"
                    >
                      <TableCell>{sourceRowLabel(entry.row)}</TableCell>
                      <TableCell>
                        {entry.row.membershipNumber} — {entry.row.displayName}
                      </TableCell>
                      <TableCell>{entry.conflict.field}</TableCell>
                      <TableCell className={cn('text-muted-foreground', WRAP)}>
                        {entry.conflict.incoming}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CollapsibleContent>
        </CardContent>
      </Collapsible>
    </Card>
  );
}

function ApplyOutcomeReport({
  outcome,
  recurringFailures,
  otherFailures,
}: {
  outcome: ApplyOutcome;
  recurringFailures: ApplyOutcome['failures'];
  otherFailures: ApplyOutcome['failures'];
}) {
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
        <div className={SCROLLER} data-test="roster-failures">
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
                  <TableCell className={cn('text-muted-foreground', WRAP)}>
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
