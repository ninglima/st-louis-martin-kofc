'use client';

import { useEffect, useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { zodResolver } from '@hookform/resolvers/zod';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';

import { Button } from '@kit/ui/button';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import { NativeSelect } from '@kit/ui/native-select';
import { toast } from '@kit/ui/sonner';
import { Switch } from '@kit/ui/switch';
import { Textarea } from '@kit/ui/textarea';

import { formatDay } from '../lib/format';
import {
  EventFormSchema,
  type EventFormValues,
  WEEKDAYS,
  defaultEventValues,
  toRepeatRule,
} from '../schemas';
import {
  createEventAction,
  previewSeriesAction,
  updateEventAction,
} from '../server/events-actions';
import type { EventType } from '../types';
import { MemberPicker } from './member-picker';

const NTH = [
  { value: 1, label: 'First' },
  { value: 2, label: 'Second' },
  { value: 3, label: 'Third' },
  { value: 4, label: 'Fourth' },
  { value: -1, label: 'Last' },
];

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-destructive text-sm">{message}</p> : null;
}

export function EventForm({
  types,
  today,
  initial,
  eventId,
  inSeries = false,
}: {
  types: EventType[];
  today: string;
  initial?: EventFormValues;
  eventId?: string;
  inSeries?: boolean;
}) {
  const router = useRouter();
  const [saving, start] = useTransition();
  const [scope, setScope] = useState<'this' | 'following'>('this');
  const [preview, setPreview] = useState<string | null>(null);

  const form = useForm<EventFormValues>({
    resolver: zodResolver(EventFormSchema),
    defaultValues: initial ?? defaultEventValues(types[0]?.id ?? '', today),
  });
  const { register, control, handleSubmit, setValue, formState } = form;
  const shifts = useFieldArray({ control, name: 'shifts' });
  const values = useWatch({ control });
  const repeat = values.repeat;

  // A live "Creates N events" line, from the same function that creates them.
  /* eslint-disable react-hooks/exhaustive-deps -- deps below list only the
     primitive fields of `repeat`/`values` that actually change the preview;
     the effect reads the objects themselves but should not re-run on every
     unrelated field edit. */
  useEffect(() => {
    if (
      eventId ||
      !repeat ||
      repeat.freq === 'none' ||
      !repeat.until ||
      !values.date
    ) {
      setPreview(null);
      return;
    }
    const rule = toRepeatRule({ ...(values as EventFormValues) });
    if (!rule) return;

    const timer = setTimeout(async () => {
      const result = await previewSeriesAction({
        ...rule,
        start_date: values.date,
      });
      if (!result.success) return setPreview(result.error);
      const p = result.data!;
      setPreview(
        p.count === 0
          ? 'Creates no events'
          : `Creates ${p.count} event${p.count === 1 ? '' : 's'}, ${formatDay(`${p.first}T18:00:00Z`)} – ${formatDay(`${p.last}T18:00:00Z`)}`,
      );
    }, 300);

    return () => clearTimeout(timer);
  }, [
    eventId,
    repeat?.freq,
    repeat?.interval,
    repeat?.weekdays,
    repeat?.weekday,
    repeat?.nth,
    repeat?.until,
    values.date,
  ]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const onSubmit = (v: EventFormValues) =>
    start(async () => {
      if (eventId) {
        const result = await updateEventAction({ eventId, scope, values: v });
        if (!result.success) return void toast.error(result.error);
        toast.success('Event saved.');
        router.push(`/home/events/${eventId}`);
        return;
      }
      const result = await createEventAction(v);
      if (!result.success) return void toast.error(result.error);
      const created = result.data!;
      toast.success(
        created.eventIds.length > 1
          ? `${created.eventIds.length} events created.`
          : 'Event created.',
      );
      router.push(`/home/events/${created.eventIds[0]}`);
    });

  const errors = formState.errors;

  return (
    <form
      noValidate
      className="flex max-w-3xl flex-col gap-6"
      data-test="event-form"
      onSubmit={handleSubmit(onSubmit)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="event-type">Event type</Label>
          <NativeSelect
            id="event-type"
            data-test="event-type"
            {...register('type_id')}
          >
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </NativeSelect>
          <FieldError message={errors.type_id?.message} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="event-title">Title</Label>
          <Input
            id="event-title"
            data-test="event-title"
            {...register('title')}
          />
          <FieldError message={errors.title?.message} />
        </div>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="event-description">Description</Label>
          <Textarea
            id="event-description"
            rows={3}
            {...register('description')}
          />
          <FieldError message={errors.description?.message} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="event-location">Location</Label>
          <Input
            id="event-location"
            data-test="event-location"
            {...register('location')}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="event-date">Date</Label>
          <Input
            id="event-date"
            type="date"
            data-test="event-date"
            disabled={Boolean(eventId) && scope === 'following'}
            {...register('date')}
          />
          <FieldError message={errors.date?.message} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="event-start">Starts</Label>
          <Input
            id="event-start"
            type="time"
            data-test="event-start"
            disabled={Boolean(eventId) && scope === 'following'}
            {...register('start_time')}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="event-end">Ends</Label>
          <Input
            id="event-end"
            type="time"
            data-test="event-end"
            disabled={Boolean(eventId) && scope === 'following'}
            {...register('end_time')}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Lead</Label>
          {values.lead_member_id ? (
            <div className="flex items-center gap-2 text-sm">
              <span data-test="event-lead-name">{values.lead_name}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setValue('lead_member_id', '', { shouldDirty: true });
                  setValue('lead_name', '');
                }}
              >
                Remove
              </Button>
            </div>
          ) : (
            <MemberPicker
              eventId={null}
              dataTest="event-lead"
              placeholder="Search for the event lead"
              onPick={(m) => {
                setValue('lead_member_id', m.id, { shouldDirty: true });
                setValue('lead_name', m.fullName);
              }}
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="event-public"
            data-test="event-public"
            checked={values.is_public ?? false}
            onCheckedChange={(checked) =>
              setValue('is_public', checked === true, { shouldDirty: true })
            }
          />
          <Label htmlFor="event-public">Show on public calendar</Label>
        </div>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="font-heading font-semibold">Shifts</legend>
        {eventId && inSeries ? (
          <p className="text-muted-foreground text-xs">
            Shift changes apply to this event only.
          </p>
        ) : null}
        {shifts.fields.map((field, i) => (
          <div key={field.id} className="flex flex-wrap items-end gap-2">
            <Input
              type="time"
              aria-label="Shift start"
              data-test={`shift-row-${i}-start`}
              className="w-32"
              {...register(`shifts.${i}.start_time`)}
            />
            <Input
              type="time"
              aria-label="Shift end"
              data-test={`shift-row-${i}-end`}
              className="w-32"
              {...register(`shifts.${i}.end_time`)}
            />
            <Input
              type="number"
              min={1}
              max={200}
              aria-label="Volunteers needed"
              data-test={`shift-row-${i}-capacity`}
              className="w-24"
              {...register(`shifts.${i}.capacity`, { valueAsNumber: true })}
            />
            <Input
              aria-label="Shift label"
              placeholder="Label (optional)"
              data-test={`shift-row-${i}-label`}
              className="w-48"
              {...register(`shifts.${i}.label`)}
            />
            {shifts.fields.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => shifts.remove(i)}
              >
                Remove
              </Button>
            ) : null}
            <FieldError
              message={
                errors.shifts?.[i]?.capacity?.message ??
                errors.shifts?.[i]?.start_time?.message
              }
            />
          </div>
        ))}
        <FieldError
          message={errors.shifts?.message ?? errors.shifts?.root?.message}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          data-test="shift-add"
          onClick={() =>
            shifts.append({
              start_time: values.start_time ?? '09:00',
              end_time: values.end_time ?? '12:00',
              capacity: 4,
              label: '',
            })
          }
        >
          Add shift
        </Button>
      </fieldset>

      {!eventId ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="font-heading font-semibold">Repeat</legend>
          <NativeSelect
            aria-label="Repeat"
            data-test="repeat-freq"
            className="w-48"
            {...register('repeat.freq')}
          >
            <option value="none">Does not repeat</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </NativeSelect>
          {repeat?.freq === 'weekly' ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">Every</span>
              <NativeSelect
                aria-label="Every how many weeks"
                data-test="repeat-interval"
                {...register('repeat.interval', { valueAsNumber: true })}
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? 'week' : `${n} weeks`}
                  </option>
                ))}
              </NativeSelect>
              <span className="text-sm">on</span>
              {WEEKDAYS.map((label, day) => {
                const on = repeat.weekdays?.includes(day) ?? false;
                return (
                  <Button
                    key={label}
                    type="button"
                    size="sm"
                    variant={on ? 'default' : 'outline'}
                    aria-pressed={on}
                    data-test={`repeat-weekday-${day}`}
                    onClick={() =>
                      setValue(
                        'repeat.weekdays',
                        on
                          ? (repeat.weekdays ?? []).filter((d) => d !== day)
                          : [...(repeat.weekdays ?? []), day].sort(),
                        {
                          shouldDirty: true,
                          shouldValidate: formState.isSubmitted,
                        },
                      )
                    }
                  >
                    {label}
                  </Button>
                );
              })}
              <FieldError message={errors.repeat?.weekdays?.message} />
            </div>
          ) : null}
          {repeat?.freq === 'monthly' ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">On the</span>
              <NativeSelect
                aria-label="Which week"
                data-test="repeat-nth"
                {...register('repeat.nth', { valueAsNumber: true })}
              >
                {NTH.map((n) => (
                  <option key={n.value} value={n.value}>
                    {n.label}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label="Weekday"
                data-test="repeat-monthly-weekday"
                {...register('repeat.weekday', { valueAsNumber: true })}
              >
                {WEEKDAYS.map((label, day) => (
                  <option key={label} value={day}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
              <span className="text-sm">of each month</span>
            </div>
          ) : null}
          {repeat?.freq && repeat.freq !== 'none' ? (
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="repeat-until">Until</Label>
              <Input
                id="repeat-until"
                type="date"
                className="w-44"
                data-test="repeat-until"
                {...register('repeat.until')}
              />
              <FieldError message={errors.repeat?.until?.message} />
              {preview ? (
                <p
                  className="text-muted-foreground text-sm"
                  data-test="repeat-preview"
                >
                  {preview}
                </p>
              ) : null}
            </div>
          ) : null}
        </fieldset>
      ) : null}

      {eventId && inSeries ? (
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="font-heading font-semibold">
            Apply changes to
          </legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="scope"
              checked={scope === 'this'}
              data-test="event-scope-this"
              onChange={() => setScope('this')}
            />
            This event
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="scope"
              checked={scope === 'following'}
              data-test="event-scope-following"
              onChange={() => setScope('following')}
            />
            This and all later events (times stay as they are)
          </label>
        </fieldset>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={saving} data-test="event-save">
          {saving ? 'Saving…' : eventId ? 'Save changes' : 'Create event'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
