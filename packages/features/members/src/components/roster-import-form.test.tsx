import { renderToStaticMarkup } from 'react-dom/server';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { installDom, mount } from '../../test/dom';
import { RosterImportForm } from './roster-import-form';

const { previewRosterAction, applyRosterChunkAction, toast } = vi.hoisted(
  () => ({
    previewRosterAction: vi.fn(),
    applyRosterChunkAction: vi.fn(),
    toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
  }),
);

vi.mock('../server/roster-actions', () => ({
  previewRosterAction,
  applyRosterChunkAction,
}));

vi.mock('@kit/ui/sonner', () => ({ toast }));

const EMPTY_PLAN = {
  rows: [],
  counts: { create: 0, update: 0, nochange: 0, skip: 0 },
  absentFromFile: [],
  rowErrors: [],
};

/**
 * The form builds its own `FormData` from the submitted `<form>`, and jsdom
 * gives no way to put a file into a file input: `DataTransfer` is not
 * implemented and `FileList` is a proxy that refuses writes. Rather than reach
 * into jsdom's internals, the test supplies the one entry the component reads.
 * Everything else -- the submit, the transition, the branch, the toast, the
 * screen swap -- is the real thing.
 */
function withChosenFile(name: string) {
  const RealFormData = globalThis.FormData;

  class ChosenFile extends RealFormData {
    constructor(form?: HTMLFormElement) {
      super(form);

      this.set('file', new File(['membershipNumber\n1000001'], name));
    }
  }

  vi.stubGlobal('FormData', ChosenFile);
}

beforeAll(installDom);

beforeEach(() => {
  previewRosterAction.mockReset();
  toast.error.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The upload half of the wizard. A review found that no test imported this
 * file at all: both of its `toast.error` branches and the transition that
 * swaps the upload card for the preview were guarded by nothing.
 */
describe('RosterImportForm', () => {
  it('accepts only the two formats Supreme exports, and says nothing is stored', () => {
    const html = renderToStaticMarkup(<RosterImportForm />);

    expect(html).toContain('data-test="roster-file"');
    expect(html).toContain('accept=".xlsx,.csv"');
    expect(html).toContain('read in memory and never stored');
  });

  it('asks for a file rather than posting an empty upload', async () => {
    const screen = await mount(<RosterImportForm />);

    await screen.click('roster-upload');

    expect(toast.error).toHaveBeenCalledWith('Choose a roster file to upload.');

    // The point of the branch: an empty submit never reaches the server.
    expect(previewRosterAction).not.toHaveBeenCalled();
    expect(screen.find('roster-preview')).toBeNull();

    screen.unmount();
  });

  it('shows the action’s own reason and stays on the upload card', async () => {
    // Next.js redacts THROWN Server Action messages in production, which is
    // why this one is returned -- and "missing required columns:
    // membershipNumber" is the entire value of the message.
    previewRosterAction.mockResolvedValue({
      success: false,
      error: 'missing required columns: membershipNumber',
    });

    withChosenFile('roster.csv');

    const screen = await mount(<RosterImportForm />);

    await screen.click('roster-upload');

    expect(toast.error).toHaveBeenCalledWith(
      'missing required columns: membershipNumber',
    );

    // Still on the upload card: a rejected file must not look like it produced
    // a plan somebody could confirm.
    expect(screen.find('roster-preview')).toBeNull();
    expect(screen.find('roster-file')).not.toBeNull();

    screen.unmount();
  });

  it('swaps the upload card for the preview once a plan exists', async () => {
    previewRosterAction.mockResolvedValue({
      success: true,
      importId: '00000000-0000-0000-0000-000000000000',
      plan: EMPTY_PLAN,
    });

    withChosenFile('september-roster.csv');

    const screen = await mount(<RosterImportForm />);

    await screen.click('roster-upload');

    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.find('roster-preview')).not.toBeNull();

    // The preview names the file the officer actually chose, not a placeholder
    // -- an officer with three exports in a downloads folder needs to know
    // which one this plan came from.
    expect(screen.container.textContent).toContain('september-roster.csv');

    // And it says, before anything else, that nothing has happened yet.
    expect(screen.container.textContent).toContain(
      'Nothing has been written yet',
    );

    screen.unmount();
  });
});
