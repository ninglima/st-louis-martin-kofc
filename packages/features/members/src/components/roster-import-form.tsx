'use client';

import { useRef, useState, useTransition } from 'react';

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

import { previewRosterAction } from '../server/roster-actions';
import type { PreviewPlan } from '../server/roster-actions';
import { RosterImportPreview } from './roster-import-preview';

interface Previewed {
  importId: string;
  filename: string;
  plan: PreviewPlan;
}

/**
 * Upload, then preview, then apply — in that order, on one screen.
 *
 * The upload writes nothing. `previewRosterAction` reads the file in memory,
 * compares it with the council's records and saves a plan; every member row it
 * would touch is on screen before the officer presses anything. That is the
 * point of the screen, so the form deliberately has no "upload and apply"
 * shortcut.
 */
export function RosterImportForm() {
  const [pending, startTransition] = useTransition();
  const [previewed, setPreviewed] = useState<Previewed | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // Read before the transition starts: `currentTarget` is null by the time
    // an async callback runs.
    const formData = new FormData(event.currentTarget);
    const file = formData.get('file');

    if (!(file instanceof File) || file.size === 0) {
      toast.error('Choose a roster file to upload.');

      return;
    }

    startTransition(async () => {
      // The action RETURNS its failures rather than throwing them, because
      // Next.js redacts thrown Server Action messages in production and
      // "missing required columns: membershipNumber" is the whole message.
      const result = await previewRosterAction(formData);

      if (!result.success) {
        toast.error(result.error);

        return;
      }

      setPreviewed({
        importId: result.importId,
        filename: file.name,
        plan: result.plan,
      });
    });
  };

  const onStartOver = () => {
    setPreviewed(null);
    formRef.current?.reset();
  };

  return (
    <div className="flex w-full flex-col gap-y-6">
      <If condition={previewed === null}>
        <Card>
          <CardHeader>
            <CardTitle>Import the council roster</CardTitle>

            <CardDescription>
              Upload the membership export from Supreme. You will see exactly
              what would change before anything is written.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form
              ref={formRef}
              onSubmit={onSubmit}
              className="flex flex-col gap-y-4"
            >
              <div className="flex flex-col gap-y-2">
                <Label htmlFor="roster-file">Roster file (.xlsx or .csv)</Label>

                <Input
                  id="roster-file"
                  name="file"
                  type="file"
                  accept=".xlsx,.csv"
                  disabled={pending}
                  data-test="roster-file"
                  className="h-auto py-1.5"
                />

                <p className="text-muted-foreground text-sm">
                  Up to 5 MB. The file is read in memory and never stored.
                </p>
              </div>

              <Button
                type="submit"
                className="self-start"
                disabled={pending}
                data-test="roster-upload"
              >
                {pending ? 'Reading the file…' : 'Preview this import'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </If>

      <If condition={previewed}>
        {(preview) => (
          <RosterImportPreview
            importId={preview.importId}
            filename={preview.filename}
            plan={preview.plan}
            onStartOver={onStartOver}
          />
        )}
      </If>
    </div>
  );
}
