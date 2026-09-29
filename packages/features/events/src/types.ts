export type ProgramCategory = 'faith' | 'family' | 'community' | 'life';

export const CATEGORY_LABELS: Record<ProgramCategory, string> = {
  faith: 'Faith',
  family: 'Family',
  community: 'Community',
  life: 'Life',
};

export type SignupStatus = 'signed_up' | 'cancelled' | 'attended' | 'no_show';
export type EventStatus = 'scheduled' | 'cancelled';

export interface EventType {
  id: string;
  name: string;
  category: ProgramCategory;
  description: string | null;
  active: boolean;
}

export interface CalendarEvent {
  id: string;
  title: string;
  typeId: string;
  typeName: string;
  category: ProgramCategory;
  startsAt: string;
  endsAt: string;
  status: EventStatus;
  isPublic: boolean;
  seriesId: string | null;
  capacity: number;
  filled: number;
  signedUp: boolean;
}

export interface ShiftSignup {
  id: string;
  memberId: string;
  name: string;
  status: SignupStatus;
  hours: number | null;
}

export interface EventShift {
  id: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  label: string | null;
  filled: number;
  signups: ShiftSignup[];
}

export interface EventDetail {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  status: EventStatus;
  isPublic: boolean;
  seriesId: string | null;
  typeId: string;
  typeName: string;
  category: ProgramCategory;
  leadMemberId: string | null;
  leadName: string | null;
  canTakeAttendance: boolean;
  canManage: boolean;
  myMemberId: string | null;
  shifts: EventShift[];
}

export interface MemberOption {
  id: string;
  fullName: string;
  membershipNumber: string;
}

export interface SeriesPreview {
  count: number;
  first: string | null;
  last: string | null;
}

export type MyVolunteering =
  | { linked: false }
  | {
      linked: true;
      year: number;
      yearHours: number;
      allTimeHours: number;
      byCategory: { category: ProgramCategory; hours: number }[];
      upcoming: {
        signupId: string;
        eventId: string;
        title: string;
        startsAt: string;
        endsAt: string;
        label: string | null;
      }[];
      history: {
        signupId: string;
        eventId: string;
        title: string;
        typeName: string;
        startsAt: string;
        status: SignupStatus;
        hours: number | null;
        eventCancelled: boolean;
      }[];
    };

export interface ReportMemberRow {
  memberId: string;
  name: string;
  membershipNumber: string;
  events: number;
  hours: number;
}

export interface VolunteerReport {
  year: number;
  totals: { hours: number; volunteers: number; events: number };
  byCategory: {
    category: ProgramCategory;
    hours: number;
    volunteers: number;
    events: number;
  }[];
  byType: {
    typeId: string;
    name: string;
    category: ProgramCategory;
    hours: number;
    volunteers: number;
    events: number;
  }[];
  byMember: ReportMemberRow[];
  pending: {
    eventId: string;
    title: string;
    shiftId: string;
    startsAt: string;
    endsAt: string;
    leadName: string | null;
    waiting: number;
  }[];
}

export type EventsActionResult<T = undefined> =
  | { success: true; data?: T }
  | { success: false; error: string };
