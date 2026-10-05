'use client';

import { useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Input } from '@kit/ui/input';
import { NativeSelect } from '@kit/ui/native-select';
import { toast } from '@kit/ui/sonner';

import { saveEventTypeAction } from '../server/events-actions';
import {
  CATEGORY_LABELS,
  type EventType,
  type ProgramCategory,
} from '../types';

const EMPTY = {
  id: undefined as string | undefined,
  name: '',
  category: 'community' as ProgramCategory,
  description: '',
  active: true,
};

export function EventTypesManager({ types }: { types: EventType[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState(EMPTY);
  const [pending, start] = useTransition();

  const save = (values: typeof EMPTY) =>
    start(async () => {
      try {
        const result = await saveEventTypeAction(values);
        if (result.success) {
          toast.success('Event type saved.');
          setDraft(EMPTY);
          router.refresh();
        } else {
          toast.error(result.error);
        }
      } catch {
        toast.error('Something went wrong. Please try again.');
      }
    });

  return (
    <div className="flex max-w-3xl flex-col gap-6" data-test="event-types">
      <form
        noValidate
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save(draft);
        }}
      >
        <Input
          className="w-64"
          placeholder="Type name"
          aria-label="Type name"
          data-test="event-type-name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <NativeSelect
          aria-label="Category"
          data-test="event-type-category"
          value={draft.category}
          onChange={(e) =>
            setDraft({ ...draft, category: e.target.value as ProgramCategory })
          }
        >
          {(Object.keys(CATEGORY_LABELS) as ProgramCategory[]).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </NativeSelect>
        <Button type="submit" disabled={pending} data-test="event-type-save">
          {draft.id ? 'Save type' : 'Add type'}
        </Button>
        {draft.id ? (
          <Button type="button" variant="ghost" onClick={() => setDraft(EMPTY)}>
            Cancel
          </Button>
        ) : null}
      </form>
      <ul className="flex flex-col divide-y rounded-lg border">
        {types.map((t) => (
          <li
            key={t.id}
            className="flex items-center justify-between gap-2 p-3"
          >
            <span className="flex items-center gap-2">
              {t.name}
              <Badge variant="outline">{CATEGORY_LABELS[t.category]}</Badge>
              {!t.active ? <Badge variant="secondary">Inactive</Badge> : null}
            </span>
            <span className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setDraft({
                    id: t.id,
                    name: t.name,
                    category: t.category,
                    description: t.description ?? '',
                    active: t.active,
                  })
                }
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  save({
                    id: t.id,
                    name: t.name,
                    category: t.category,
                    description: t.description ?? '',
                    active: !t.active,
                  })
                }
              >
                {t.active ? 'Deactivate' : 'Reactivate'}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
