import { describe, expect, it } from 'vitest';

import {
  EventFormSchema,
  defaultEventValues,
  toCreatePayload,
  toUpdateFields,
} from './schemas';

const base = () => ({
  ...defaultEventValues('11111111-1111-1111-1111-111111111111', '2040-10-06'),
  title: 'Pantry',
});

describe('EventFormSchema', () => {
  it('accepts the defaults with a title', () => {
    expect(EventFormSchema.safeParse(base()).success).toBe(true);
  });

  it('needs at least one shift and valid capacities', () => {
    const noShifts = EventFormSchema.safeParse({ ...base(), shifts: [] });
    expect(noShifts.error?.issues[0]?.message).toBe('Add at least one shift');

    const zero = EventFormSchema.safeParse({
      ...base(),
      shifts: [{ ...base().shifts[0]!, capacity: 0 }],
    });
    expect(zero.error?.issues[0]?.message).toBe('At least 1 volunteer');
  });

  it('refuses an end time equal to the start time, for the event and for a shift', () => {
    const sameEventTimes = EventFormSchema.safeParse({
      ...base(),
      start_time: '09:00',
      end_time: '09:00',
    });
    expect(sameEventTimes.error?.issues[0]?.message).toBe(
      'The end time must differ from the start time',
    );
    expect(sameEventTimes.error?.issues[0]?.path).toEqual(['end_time']);

    const sameShiftTimes = EventFormSchema.safeParse({
      ...base(),
      shifts: [
        { ...base().shifts[0]!, start_time: '10:00', end_time: '10:00' },
      ],
    });
    expect(sameShiftTimes.error?.issues[0]?.message).toBe(
      'The end time must differ from the start time',
    );
    expect(sameShiftTimes.error?.issues[0]?.path).toEqual([
      'shifts',
      0,
      'end_time',
    ]);
  });

  it('needs weekdays and an end date for a weekly repeat', () => {
    const r = EventFormSchema.safeParse({
      ...base(),
      repeat: { ...base().repeat, freq: 'weekly', weekdays: [], until: '' },
    });
    expect(r.error?.issues.map((i) => i.message).sort()).toEqual([
      'Choose at least one weekday',
      'Choose when the repeat ends',
    ]);
  });
});

describe('payloads', () => {
  it('omits repeat when it is none and builds a weekly rule otherwise', () => {
    expect(toCreatePayload(base())).not.toHaveProperty('repeat');
    expect(
      toCreatePayload({
        ...base(),
        repeat: {
          ...base().repeat,
          freq: 'weekly',
          weekdays: [2],
          interval: 1,
          until: '2040-12-01',
        },
      }).repeat,
    ).toEqual({
      freq: 'weekly',
      interval: 1,
      weekdays: [2],
      until: '2040-12-01',
    });
    expect(
      toCreatePayload({
        ...base(),
        repeat: {
          ...base().repeat,
          freq: 'monthly',
          weekday: 6,
          nth: -1,
          until: '2040-12-01',
        },
      }).repeat,
    ).toEqual({ freq: 'monthly', weekday: 6, nth: -1, until: '2040-12-01' });
  });

  it('sends times only when editing one event', () => {
    expect(toUpdateFields(base(), 'this')).toHaveProperty(
      'start_time',
      '09:00',
    );
    expect(toUpdateFields(base(), 'following')).not.toHaveProperty(
      'start_time',
    );
    expect(toUpdateFields(base(), 'following')).not.toHaveProperty('date');
  });
});
