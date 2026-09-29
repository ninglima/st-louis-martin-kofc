import * as z from 'zod';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const WEEKDAYS = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
] as const;

const ShiftRowSchema = z.object({
  id: z.string().optional(),
  start_time: z.string().regex(TIME, 'Enter a start time'),
  end_time: z.string().regex(TIME, 'Enter an end time'),
  capacity: z
    .number({ error: 'Enter the number of volunteers needed' })
    .int('Whole volunteers only')
    .min(1, 'At least 1 volunteer')
    .max(200, 'At most 200 volunteers'),
  label: z.string().trim().max(100, 'Label must be 100 characters or fewer'),
});

const RepeatSchema = z.object({
  freq: z.enum(['none', 'weekly', 'monthly']),
  interval: z.number().int().min(1).max(4),
  weekdays: z.array(z.number().int().min(0).max(6)),
  weekday: z.number().int().min(0).max(6),
  nth: z
    .number()
    .int()
    .refine(
      (n) => (n >= 1 && n <= 4) || n === -1,
      'Choose first to fourth, or last',
    ),
  until: z.string(),
});

export const EventFormSchema = z
  .object({
    type_id: z.string().min(1, 'Choose an event type'),
    title: z
      .string()
      .trim()
      .min(1, 'Title is required')
      .max(200, 'Title must be 200 characters or fewer'),
    description: z
      .string()
      .trim()
      .max(5000, 'Description must be 5000 characters or fewer'),
    location: z
      .string()
      .trim()
      .max(300, 'Location must be 300 characters or fewer'),
    date: z.string().regex(DATE, 'Choose a date'),
    start_time: z.string().regex(TIME, 'Enter a start time'),
    end_time: z.string().regex(TIME, 'Enter an end time'),
    lead_member_id: z.string(),
    lead_name: z.string(),
    is_public: z.boolean(),
    shifts: z
      .array(ShiftRowSchema)
      .min(1, 'Add at least one shift')
      .max(20, 'At most 20 shifts'),
    repeat: RepeatSchema,
  })
  .superRefine((v, ctx) => {
    if (v.repeat.freq === 'weekly' && v.repeat.weekdays.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['repeat', 'weekdays'],
        message: 'Choose at least one weekday',
      });
    }
    if (v.repeat.freq !== 'none' && !DATE.test(v.repeat.until)) {
      ctx.addIssue({
        code: 'custom',
        path: ['repeat', 'until'],
        message: 'Choose when the repeat ends',
      });
    }
  });

export type EventFormValues = z.infer<typeof EventFormSchema>;

export const EventTypeSchema = z.object({
  id: z.string().optional(),
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(100, 'Name must be 100 characters or fewer'),
  category: z.enum(['faith', 'family', 'community', 'life']),
  description: z
    .string()
    .trim()
    .max(1000, 'Description must be 1000 characters or fewer'),
  active: z.boolean(),
});

export type EventTypeValues = z.infer<typeof EventTypeSchema>;

export type RepeatRule =
  | { freq: 'weekly'; interval: number; weekdays: number[]; until: string }
  | { freq: 'monthly'; weekday: number; nth: number; until: string };

export function toRepeatRule(v: EventFormValues): RepeatRule | null {
  const r = v.repeat;

  if (r.freq === 'weekly')
    return {
      freq: 'weekly',
      interval: r.interval,
      weekdays: r.weekdays,
      until: r.until,
    };
  if (r.freq === 'monthly')
    return { freq: 'monthly', weekday: r.weekday, nth: r.nth, until: r.until };

  return null;
}

export function toShiftsPayload(shifts: EventFormValues['shifts']) {
  return shifts.map((s) => ({
    ...(s.id ? { id: s.id } : {}),
    start_time: s.start_time,
    end_time: s.end_time,
    capacity: s.capacity,
    label: s.label,
  }));
}

export function toCreatePayload(v: EventFormValues) {
  const rule = toRepeatRule(v);

  return {
    type_id: v.type_id,
    title: v.title,
    description: v.description,
    location: v.location,
    date: v.date,
    start_time: v.start_time,
    end_time: v.end_time,
    lead_member_id: v.lead_member_id || null,
    is_public: v.is_public,
    shifts: toShiftsPayload(v.shifts),
    ...(rule ? { repeat: rule } : {}),
  };
}

/** `following` never carries times: `event_update` refuses series-wide time changes. */
export function toUpdateFields(
  v: EventFormValues,
  scope: 'this' | 'following',
) {
  const fields = {
    type_id: v.type_id,
    title: v.title,
    description: v.description,
    location: v.location,
    lead_member_id: v.lead_member_id || null,
    is_public: v.is_public,
  };

  return scope === 'this'
    ? {
        ...fields,
        date: v.date,
        start_time: v.start_time,
        end_time: v.end_time,
      }
    : fields;
}

export function defaultEventValues(
  typeId: string,
  date: string,
): EventFormValues {
  return {
    type_id: typeId,
    title: '',
    description: '',
    location: '',
    date,
    start_time: '09:00',
    end_time: '12:00',
    lead_member_id: '',
    lead_name: '',
    is_public: false,
    shifts: [
      { start_time: '09:00', end_time: '12:00', capacity: 4, label: '' },
    ],
    repeat: {
      freq: 'none',
      interval: 1,
      weekdays: [],
      weekday: 6,
      nth: 1,
      until: '',
    },
  };
}
