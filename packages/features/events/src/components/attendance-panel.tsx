'use client';

import { useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Input } from '@kit/ui/input';
import { NativeSelect } from '@kit/ui/native-select';
import { toast } from '@kit/ui/sonner';

import { formatTimeRange } from '../lib/format';
import {
  addVolunteerAction,
  setAttendanceAction,
} from '../server/events-actions';
import type { EventDetail, ShiftSignup } from '../types';
import { MemberPicker } from './member-picker';

function Row({ signup, started }: { signup: ShiftSignup; started: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<'attended' | 'no_show'>(
    signup.status === 'no_show' ? 'no_show' : 'attended',
  );
  const [hours, setHours] = useState(
    signup.hours === null ? '' : String(signup.hours),
  );

  const save = () =>
    start(async () => {
      const result = await setAttendanceAction({
        signupId: signup.id,
        status,
        hours: status === 'attended' && hours !== '' ? Number(hours) : null,
      });
      if (result.success) {
        toast.success('Attendance saved.');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="min-w-40">{signup.name}</span>
      <NativeSelect
        aria-label={`Attendance for ${signup.name}`}
        data-test={`attendance-status-${signup.id}`}
        value={status}
        disabled={!started}
        onChange={(e) => setStatus(e.target.value as 'attended' | 'no_show')}
      >
        <option value="attended">Attended</option>
        <option value="no_show">No-show</option>
      </NativeSelect>
      <Input
        className="w-24"
        type="number"
        step="0.25"
        min="0"
        max="24"
        placeholder="Hours"
        aria-label={`Hours for ${signup.name}`}
        data-test={`attendance-hours-${signup.id}`}
        value={hours}
        disabled={!started || status === 'no_show'}
        onChange={(e) => setHours(e.target.value)}
      />
      <Button
        size="sm"
        disabled={!started || pending}
        data-test={`attendance-save-${signup.id}`}
        onClick={save}
      >
        Save
      </Button>
      {signup.status === 'attended' ? (
        <span className="text-muted-foreground text-sm">Confirmed</span>
      ) : null}
    </li>
  );
}

export function AttendancePanel({ event }: { event: EventDetail }) {
  const router = useRouter();
  const now = Date.now();

  return (
    <Card data-test="attendance-panel">
      <CardHeader>
        <CardTitle>Attendance</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {event.shifts.map((shift) => {
          const started = new Date(shift.startsAt).getTime() <= now;

          return (
            <section key={shift.id} className="flex flex-col gap-2">
              <h3 className="font-medium">
                {formatTimeRange(shift.startsAt, shift.endsAt)}
              </h3>
              {!started ? (
                <p className="text-muted-foreground text-sm">
                  Attendance opens when the shift starts.
                </p>
              ) : null}
              <ul className="flex flex-col gap-2">
                {shift.signups.map((s) => (
                  // Keying on status/hours too (not just id) forces a fresh
                  // `Row` -- and so fresh `useState` initial values -- after
                  // a save changes them server-side and `router.refresh()`
                  // re-renders with the new props. Otherwise the mounted
                  // instance keeps showing what the officer typed before
                  // Save, even once the DB has a different value (e.g. hours
                  // defaulted to the shift length after a blank save).
                  <Row
                    key={`${s.id}:${s.status}:${s.hours}`}
                    signup={s}
                    started={started}
                  />
                ))}
              </ul>
              <MemberPicker
                eventId={event.id}
                placeholder="Add a walk-in volunteer"
                dataTest={`add-volunteer-${shift.id}`}
                onPick={async (m) => {
                  const result = await addVolunteerAction({
                    shiftId: shift.id,
                    memberId: m.id,
                  });
                  if (result.success) {
                    toast.success(`${m.fullName} added.`);
                    router.refresh();
                  } else {
                    toast.error(result.error);
                  }
                }}
              />
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
