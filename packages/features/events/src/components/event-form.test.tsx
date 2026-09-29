import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventForm } from './event-form';

const push = vi.fn();
const h = vi.hoisted(() => ({
  create: vi.fn(),
  preview: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));
vi.mock('../server/events-actions', () => ({
  createEventAction: h.create,
  updateEventAction: vi.fn(),
  previewSeriesAction: h.preview,
  searchMembersAction: vi.fn(async () => ({ success: true, data: [] })),
}));

const types = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Food Pantry',
    category: 'community' as const,
    description: null,
    active: true,
  },
];

describe('EventForm', () => {
  beforeEach(() => {
    push.mockClear();
    h.create.mockReset();
    h.preview.mockReset();
    h.create.mockResolvedValue({
      success: true,
      data: { seriesId: null, eventIds: ['e1'] },
    });
    h.preview.mockResolvedValue({
      success: true,
      data: { count: 3, first: '2040-10-30', last: '2040-11-13' },
    });
  });

  it('creates a one-off event and opens it', async () => {
    render(<EventForm types={types} today="2040-10-01" />);
    fireEvent.change(screen.getByTestId('event-title'), {
      target: { value: 'Pantry' },
    });
    fireEvent.click(screen.getByTestId('event-save'));

    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect(h.create.mock.calls[0]![0]).toMatchObject({
      title: 'Pantry',
      repeat: { freq: 'none' },
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/home/events/e1'));
  });

  it('shows an error and does not submit when the end time is cleared', async () => {
    render(<EventForm types={types} today="2040-10-01" />);
    fireEvent.change(screen.getByTestId('event-title'), {
      target: { value: 'Pantry' },
    });
    fireEvent.change(screen.getByTestId('event-end'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByTestId('event-save'));

    await waitFor(() =>
      expect(screen.getByText('Enter an end time')).toBeInTheDocument(),
    );
    expect(h.create).not.toHaveBeenCalled();
  });

  it('previews a weekly repeat', async () => {
    render(<EventForm types={types} today="2040-10-01" />);
    fireEvent.change(screen.getByTestId('repeat-freq'), {
      target: { value: 'weekly' },
    });
    fireEvent.click(screen.getByTestId('repeat-weekday-2'));
    fireEvent.change(screen.getByTestId('repeat-until'), {
      target: { value: '2040-11-13' },
    });

    await waitFor(() =>
      expect(screen.getByTestId('repeat-preview')).toHaveTextContent(
        'Creates 3 events',
      ),
    );
  });
});
