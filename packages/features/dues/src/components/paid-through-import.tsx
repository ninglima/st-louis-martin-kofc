'use client';

import { useRef, useState, useTransition } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { If } from '@kit/ui/if';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import { toast } from '@kit/ui/sonner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';
import { cn } from '@kit/ui/utils';

import type { CsvIssue, PaidThroughRow } from '../csv/paid-through-csv';
import {
  applyPaidThroughAction,
  previewPaidThroughAction,
} from '../server/paid-through-actions';

interface UnknownLevel {
  membershipNumber: string;
  level: string;
}

interface Previewed {
  filename: string;
  rows: PaidThroughRow[];
  issues: CsvIssue[];
  unknownNumbers: string[];
  alreadyRecorded: string[];
  unknownLevels: UnknownLevel[];
}

interface Outcome {
  applied: number;
  skipped: { membership_number: string; reason: string }[];
}

const SCROLLER = 'max-h-96 overflow-auto rounded-lg border';
const WRAP = 'whitespace-normal break-words';

/** Matches `PaidThroughCsvTextSchema`'s cap (I3): checked client-side first
 * so an officer who picks an oversized file gets an immediate toast instead
 * of waiting on a round trip the server will refuse anyway. */
const MAX_FILE_BYTES = 1_000_000;

const ISSUE_LABELS: Record<CsvIssue['kind'], string> = {
  missing_column: 'Missing column',
  bad_date: 'Bad date',
  duplicate: 'Duplicate',
  suspicious_date: 'Suspicious date',
  blank: 'Missing value',
};

function quantify(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * The rows a load would actually write (I5): everything in `rows` except a
 * membership number the preview could not find, one that already has dues
 * recorded, or one naming a level that is not active. "Load N" and the
 * payload `applyPaidThroughAction` receives both come from this, not from
 * `rows.length` -- counting or sending a row the apply will only skip is
 * misleading, and re-running the same load is meant to be a no-op once every
 * loadable row has landed.
 */
function loadableRows(preview: Previewed): PaidThroughRow[] {
  const unknownNumbers = new Set(preview.unknownNumbers);
  const alreadyRecorded = new Set(preview.alreadyRecorded);
  const unknownLevels = new Set(
    preview.unknownLevels.map((entry) => entry.membershipNumber),
  );

  return preview.rows.filter(
    (row) =>
      !unknownNumbers.has(row.membershipNumber) &&
      !alreadyRecorded.has(row.membershipNumber) &&
      !unknownLevels.has(row.membershipNumber),
  );
}

/**
 * The Financial Secretary's one-off paid-through load: upload, preview, then
 * apply -- the same order `RosterImportForm`/`RosterImportPreview` use, and
 * for the same reason. Nothing is written until "Load N paid-through dates"
 * is pressed, and everything the apply would touch (unknown numbers, members
 * who already have dues recorded, unknown levels, dates worth a second look)
 * is on screen first.
 *
 * Kept as one component, unlike the roster's two-file split: this load has
 * no multi-chunk apply loop (`dues_opening_balances_apply` takes the whole
 * array in one RPC call) and no persisted plan to resume, so there is no
 * second piece of state worth its own file.
 */
export function PaidThroughImport() {
  const [previewPending, startPreviewTransition] = useTransition();
  const [applyPending, startApplyTransition] = useTransition();
  const [previewed, setPreviewed] = useState<Previewed | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const file = formData.get('file');

    if (!(file instanceof File) || file.size === 0) {
      toast.error('Choose a CSV file to upload.');
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      toast.error('That file is larger than 1 MB.');
      return;
    }

    startPreviewTransition(async () => {
      const text = await file.text();
      const result = await previewPaidThroughAction(text);

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      setOutcome(null);
      setPreviewed({
        filename: file.name,
        rows: result.rows,
        issues: result.issues,
        unknownNumbers: result.unknownNumbers,
        alreadyRecorded: result.alreadyRecorded,
        unknownLevels: result.unknownLevels,
      });
    });
  };

  const onStartOver = () => {
    setPreviewed(null);
    setOutcome(null);
    formRef.current?.reset();
  };

  const onApply = () => {
    if (!previewed) return;

    const loadable = loadableRows(previewed);

    startApplyTransition(async () => {
      const result = await applyPaidThroughAction(loadable);

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      setOutcome({ applied: result.applied, skipped: result.skipped });
      toast.success(`Loaded ${quantify(result.applied, 'paid-through date')}.`);
    });
  };

  return (
    <div className="flex w-full flex-col gap-y-6">
      <If condition={previewed === null}>
        <Card>
          <CardHeader>
            <CardTitle>Load paid-through dates</CardTitle>

            <CardDescription>
              Upload a CSV with membership_number, paid_through (YYYY-MM-DD or
              M/D/YYYY) and an optional dues_level. You will see exactly what
              would be recorded before anything is written.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form
              ref={formRef}
              onSubmit={onSubmit}
              className="flex flex-col gap-y-4"
            >
              <div className="flex flex-col gap-y-2">
                <Label htmlFor="paid-through-file">Paid-through CSV</Label>

                <Input
                  id="paid-through-file"
                  name="file"
                  type="file"
                  accept=".csv"
                  disabled={previewPending}
                  data-test="paid-through-file"
                  className="h-auto py-1.5"
                />
              </div>

              <Button
                type="submit"
                className="self-start"
                disabled={previewPending}
                data-test="paid-through-preview-submit"
              >
                {previewPending ? 'Reading the file…' : 'Preview this load'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </If>

      <If condition={previewed}>
        {(preview) => {
          const loadable = loadableRows(preview);

          return (
            <div
              className="flex flex-col gap-y-6"
              data-test="paid-through-preview"
            >
              <Card>
                <CardHeader>
                  <CardTitle>What this load will do</CardTitle>

                  <CardDescription>
                    Nothing has been written yet. {preview.filename} —{' '}
                    {quantify(preview.rows.length, 'row')} read,{' '}
                    {quantify(loadable.length, 'row')} loadable.
                  </CardDescription>
                </CardHeader>

                <CardContent>
                  <div className={SCROLLER}>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Row</TableHead>
                          <TableHead>Member #</TableHead>
                          <TableHead>Paid through</TableHead>
                          <TableHead>Level</TableHead>
                        </TableRow>
                      </TableHeader>

                      <TableBody>
                        {preview.rows.map((row) => {
                          const suspicious = preview.issues.some(
                            (issue) =>
                              issue.line === row.line &&
                              issue.kind === 'suspicious_date',
                          );

                          return (
                            <TableRow
                              key={row.line}
                              data-test="paid-through-preview-row"
                            >
                              <TableCell>{row.line}</TableCell>
                              <TableCell>{row.membershipNumber}</TableCell>
                              <TableCell
                                className={cn(
                                  suspicious && 'text-destructive font-medium',
                                )}
                                data-test={
                                  suspicious
                                    ? 'paid-through-suspicious'
                                    : undefined
                                }
                              >
                                {row.paidThrough}
                                {suspicious ? ' — check this date' : ''}
                              </TableCell>
                              <TableCell>{row.duesLevel ?? '—'}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              <If condition={preview.issues.length > 0}>
                <Card data-test="paid-through-issues">
                  <CardHeader>
                    <CardTitle>
                      {quantify(preview.issues.length, 'problem')} in the file
                    </CardTitle>

                    <CardDescription>
                      Rows with a problem other than a suspicious date are not
                      in the load above and will not be written.
                    </CardDescription>
                  </CardHeader>

                  <CardContent>
                    <div className={SCROLLER}>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Row</TableHead>
                            <TableHead>Member #</TableHead>
                            <TableHead>Problem</TableHead>
                            <TableHead>Why</TableHead>
                          </TableRow>
                        </TableHeader>

                        <TableBody>
                          {preview.issues.map((issue) => (
                            <TableRow
                              key={`${issue.line}-${issue.kind}`}
                              data-test="paid-through-issue-row"
                            >
                              <TableCell>{issue.line}</TableCell>
                              <TableCell>
                                {issue.membershipNumber ?? '—'}
                              </TableCell>
                              <TableCell>{ISSUE_LABELS[issue.kind]}</TableCell>
                              <TableCell
                                className={cn('text-muted-foreground', WRAP)}
                              >
                                {issue.message}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </If>

              <If condition={preview.unknownNumbers.length > 0}>
                <Card data-test="paid-through-unknown">
                  <CardHeader>
                    <CardTitle>
                      {quantify(
                        preview.unknownNumbers.length,
                        'unknown membership number',
                      )}
                    </CardTitle>

                    <CardDescription>
                      No member on the roster holds these numbers. They will be
                      skipped.
                    </CardDescription>
                  </CardHeader>

                  <CardContent>
                    <p className="text-muted-foreground text-sm">
                      {preview.unknownNumbers.join(', ')}
                    </p>
                  </CardContent>
                </Card>
              </If>

              <If condition={preview.unknownLevels.length > 0}>
                <Card data-test="paid-through-unknown-levels">
                  <CardHeader>
                    <CardTitle>
                      {quantify(
                        preview.unknownLevels.length,
                        'unknown dues level',
                      )}
                    </CardTitle>

                    <CardDescription>
                      These levels are not active, or do not exist. They will be
                      skipped.
                    </CardDescription>
                  </CardHeader>

                  <CardContent>
                    <div className={SCROLLER}>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Member #</TableHead>
                            <TableHead>Level</TableHead>
                          </TableRow>
                        </TableHeader>

                        <TableBody>
                          {preview.unknownLevels.map((entry) => (
                            <TableRow
                              key={`${entry.membershipNumber}-${entry.level}`}
                              data-test="paid-through-unknown-level-row"
                            >
                              <TableCell>{entry.membershipNumber}</TableCell>
                              <TableCell>{entry.level}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </If>

              <If condition={preview.alreadyRecorded.length > 0}>
                <Card data-test="paid-through-already-recorded">
                  <CardHeader>
                    <CardTitle>
                      {quantify(preview.alreadyRecorded.length, 'member')}{' '}
                      already have dues recorded
                    </CardTitle>

                    <CardDescription>
                      Loading an opening balance for these would overlap dues
                      already on their ledger. They will be skipped.
                    </CardDescription>
                  </CardHeader>

                  <CardContent>
                    <p className="text-muted-foreground text-sm">
                      {preview.alreadyRecorded.join(', ')}
                    </p>
                  </CardContent>
                </Card>
              </If>

              <Card>
                <CardHeader>
                  <CardTitle>Apply this load</CardTitle>

                  <CardDescription>
                    Unknown numbers, unknown levels, members who already have
                    dues recorded, and rows with a problem are skipped
                    automatically.
                  </CardDescription>
                </CardHeader>

                <CardContent className="flex flex-col gap-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    {/*
                      I5: hidden rather than merely disabled once an outcome
                      exists -- a second click would re-run the load, and
                      every row that landed the first time would come back
                      "already has dues recorded", which reads as a failure
                      rather than as nothing left to do.
                    */}
                    <If condition={outcome === null}>
                      <Button
                        data-test="paid-through-apply"
                        disabled={applyPending || loadable.length === 0}
                        onClick={onApply}
                      >
                        {applyPending
                          ? 'Loading…'
                          : `Load ${quantify(loadable.length, 'paid-through date')}`}
                      </Button>
                    </If>

                    <Button
                      variant="outline"
                      data-test="paid-through-start-over"
                      disabled={applyPending}
                      onClick={onStartOver}
                    >
                      Start over
                    </Button>
                  </div>

                  <If condition={outcome}>
                    {(result) => (
                      <div
                        className="flex flex-col gap-y-3"
                        data-test="paid-through-outcome"
                      >
                        <Alert>
                          <AlertTitle>
                            {quantify(result.applied, 'paid-through date')}{' '}
                            loaded
                          </AlertTitle>

                          <If condition={result.skipped.length > 0}>
                            <AlertDescription>
                              {quantify(result.skipped.length, 'row')} skipped.
                            </AlertDescription>
                          </If>
                        </Alert>

                        <If condition={result.skipped.length > 0}>
                          <div className={SCROLLER}>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Member #</TableHead>
                                  <TableHead>Reason</TableHead>
                                </TableRow>
                              </TableHeader>

                              <TableBody>
                                {result.skipped.map((skip, index) => (
                                  <TableRow
                                    key={`${skip.membership_number}-${index}`}
                                    data-test="paid-through-skipped-row"
                                  >
                                    <TableCell>
                                      {skip.membership_number}
                                    </TableCell>
                                    <TableCell className={WRAP}>
                                      {skip.reason}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </If>
                      </div>
                    )}
                  </If>
                </CardContent>
              </Card>
            </div>
          );
        }}
      </If>
    </div>
  );
}
