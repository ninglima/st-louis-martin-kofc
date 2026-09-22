export type Verb = 'view' | 'manage';

export interface SectionDef {
  key: string;
  label: string;
  description: string;
  verbs: readonly Verb[];
}

export const SECTIONS = [
  {
    key: 'home',
    label: 'Home',
    description: 'The main dashboard',
    verbs: ['view'],
  },
  {
    key: 'payments',
    label: 'Payments',
    description: 'View: own payment history. Manage: all members’ payments',
    verbs: ['view', 'manage'],
  },
  {
    key: 'checkout',
    label: 'Checkout',
    description: 'Make a payment',
    verbs: ['view'],
  },
  {
    key: 'payment_settings',
    label: 'Payment Settings',
    description: 'Configure the payment provider and API keys',
    verbs: ['manage'],
  },
  {
    key: 'users',
    label: 'User Management',
    description: 'View: list users. Manage: create, invite, edit, deactivate',
    verbs: ['view', 'manage'],
  },
  {
    key: 'roles',
    label: 'Roles',
    description:
      'View: see roles. Manage is equivalent to full administrator access: a holder can edit any role (including their own) and grant any permission, on any role, to anyone — including themselves.',
    verbs: ['view', 'manage'],
  },
] as const satisfies readonly SectionDef[];

export type SectionKey = (typeof SECTIONS)[number]['key'];

export function getSection(key: string): SectionDef | undefined {
  return SECTIONS.find((s) => s.key === key);
}

export function sectionSupportsVerb(key: string, verb: Verb): boolean {
  return getSection(key)?.verbs.includes(verb) ?? false;
}
