import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '@kit/supabase/database';

import type {
  CalendarEvent,
  EventDetail,
  EventType,
  MemberOption,
  MyVolunteering,
  SeriesPreview,
  VolunteerReport,
} from '../types';

type Client = SupabaseClient<Database>;

/**
 * Typed wrapper over the events RPCs. Pass the signed-in user's client
 * (`getSupabaseServerClient`): every function checks `events.*` against
 * `auth.uid()`. Errors are thrown as-is so callers keep the Postgres `code`.
 */
export class EventsService {
  constructor(private readonly client: Client) {}

  async types(includeInactive = false): Promise<EventType[]> {
    let query = this.client
      .from('event_types')
      .select('id, name, category, description, active')
      .order('name');

    if (!includeInactive) query = query.eq('active', true);

    const { data, error } = await query;
    if (error) throw error;

    return data ?? [];
  }

  async inRange(
    from: string,
    to: string,
    typeId: string | null,
  ): Promise<CalendarEvent[]> {
    const { data, error } = await this.client.rpc('events_in_range', {
      p_from: from,
      p_to: to,
      ...(typeId ? { p_type_id: typeId } : {}),
    });
    if (error) throw error;

    return (data ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      typeId: r.type_id,
      typeName: r.type_name,
      category: r.category,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      status: r.status,
      isPublic: r.is_public,
      seriesId: r.series_id,
      capacity: r.capacity,
      filled: r.filled,
      signedUp: r.signed_up,
    }));
  }

  async detail(id: string): Promise<EventDetail | null> {
    const { data, error } = await this.client.rpc('event_detail', {
      p_event_id: id,
    });

    if (error) {
      if (error.message === 'unknown event' || error.code === '22P02')
        return null;
      throw error;
    }

    return data as unknown as EventDetail;
  }

  async myVolunteering(): Promise<MyVolunteering> {
    const { data, error } = await this.client.rpc('my_volunteering');
    if (error) throw error;

    return data as unknown as MyVolunteering;
  }

  async report(year: number): Promise<VolunteerReport> {
    const { data, error } = await this.client.rpc('volunteer_report', {
      p_year: year,
    });
    if (error) throw error;

    return data as unknown as VolunteerReport;
  }

  async saveType(p: Record<string, unknown>): Promise<string> {
    const { data, error } = await this.client.rpc('event_types_save', {
      p: p as Json,
    });
    if (error) throw error;

    return data;
  }

  async create(
    p: Record<string, unknown>,
  ): Promise<{ seriesId: string | null; eventIds: string[] }> {
    const { data, error } = await this.client.rpc('event_create', {
      p: p as Json,
    });
    if (error) throw error;

    return data as unknown as { seriesId: string | null; eventIds: string[] };
  }

  async update(
    eventId: string,
    fields: Record<string, unknown>,
    scope: 'this' | 'following',
  ): Promise<void> {
    const { error } = await this.client.rpc('event_update', {
      p_event_id: eventId,
      p_fields: fields as Json,
      p_scope: scope,
    });
    if (error) throw error;
  }

  async saveShifts(
    eventId: string,
    shifts: Record<string, unknown>[],
  ): Promise<void> {
    const { error } = await this.client.rpc('event_shifts_save', {
      p_event_id: eventId,
      p_shifts: shifts as Json,
    });
    if (error) throw error;
  }

  async preview(rule: Record<string, unknown>): Promise<SeriesPreview> {
    const { data, error } = await this.client.rpc('event_series_preview', {
      p_rule: rule as Json,
    });
    if (error) throw error;

    return data as unknown as SeriesPreview;
  }

  async signup(shiftId: string): Promise<void> {
    const { error } = await this.client.rpc('event_signup', {
      p_shift_id: shiftId,
    });
    if (error) throw error;
  }

  async cancelSignup(signupId: string): Promise<void> {
    const { error } = await this.client.rpc('event_cancel_signup', {
      p_signup_id: signupId,
    });
    if (error) throw error;
  }

  async addVolunteer(shiftId: string, memberId: string): Promise<void> {
    const { error } = await this.client.rpc('event_add_volunteer', {
      p_shift_id: shiftId,
      p_member_id: memberId,
    });
    if (error) throw error;
  }

  async setAttendance(
    signupId: string,
    status: 'attended' | 'no_show',
    hours: number | null,
  ): Promise<void> {
    const { error } = await this.client.rpc('event_set_attendance', {
      p_signup_id: signupId,
      p_status: status,
      ...(hours === null ? {} : { p_hours: hours }),
    });
    if (error) throw error;
  }

  async searchMembers(
    eventId: string | null,
    query: string,
  ): Promise<MemberOption[]> {
    const { data, error } = await this.client.rpc('event_member_search', {
      p_event_id: eventId as string,
      p_query: query,
    });
    if (error) throw error;

    return (data ?? []).map((r) => ({
      id: r.id,
      fullName: r.full_name,
      membershipNumber: r.membership_number,
    }));
  }
}
