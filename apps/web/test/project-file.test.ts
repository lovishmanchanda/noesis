import { describe, expect, it } from 'vitest';
import {
  downloadName,
  parseProjectFile,
  projectFromFile,
  toProjectFile,
} from '../src/project/file';
import { initialProject, type ProjectState } from '../src/state/project';

const profile = { rows: 600, columnCount: 2, duplicates: 0, memoryMB: 1, columns: [] };
const project = (): ProjectState => ({
  ...initialProject(),
  name: 'Home prices',
  topic: 'north',
  goal: 'number',
  roles: { area: 'feature', price: 'target' },
  dataset: { name: 'homes.csv', source: 'file', settings: { delimiter: ';' }, profile },
  tidy: { dropDuplicates: true, dropMissingTarget: false, dropColumns: ['x'] },
  splitResult: { rows: { train: 420, validation: 90, test: 90 } },
});

describe('project file', () => {
  it('keeps the choices and leaves the data and results out', () => {
    const file = toProjectFile(project(), new Date('2026-11-09T10:00:00Z'));
    const text = JSON.stringify(file);
    expect(file.savedAt).toBe('2026-11-09T10:00:00.000Z');
    expect(file.project.dataset).toEqual({ name: 'homes.csv', settings: { delimiter: ';' } });
    expect(text).not.toContain('"rows":600');
    expect(text).not.toContain('splitResult');
  });

  it('round-trips through text', () => {
    const parsed = parseProjectFile(JSON.stringify(toProjectFile(project())));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const restored = projectFromFile(parsed.file);
    expect(restored.project).toMatchObject({
      name: 'Home prices',
      goal: 'number',
      roles: { price: 'target' },
      dataset: null,
      splitResult: null,
    });
    expect(restored.project.tidy.dropColumns).toEqual(['x']);
    expect(restored.completed).toEqual(['project']);
    expect(restored.screen).toBe('data');
  });

  it('sends a project without a goal back to the first screen', () => {
    const parsed = parseProjectFile(
      JSON.stringify(toProjectFile({ ...initialProject(), name: 'Empty' })),
    );
    if (!parsed.ok) throw new Error('should parse');
    expect(projectFromFile(parsed.file)).toMatchObject({ completed: [], screen: 'project' });
  });

  it('rejects files that are not project files, with a reason', () => {
    expect(parseProjectFile('not json')).toMatchObject({
      ok: false,
      reason: expect.stringContaining('not valid JSON'),
    });
    expect(parseProjectFile('{"hello": 1}')).toMatchObject({
      ok: false,
      reason: 'This is not a NOESIS project file.',
    });
    expect(parseProjectFile('[1,2]')).toMatchObject({ ok: false });
    const wrongGoal = toProjectFile(project()) as unknown as { project: { goal: string } };
    wrongGoal.project.goal = 'banana';
    expect(parseProjectFile(JSON.stringify(wrongGoal))).toMatchObject({
      ok: false,
      reason: expect.stringContaining('goal'),
    });
  });

  it('makes a safe file name', () => {
    expect(downloadName('Home prices, 2026!')).toBe('home-prices-2026.noesis.json');
    expect(downloadName('   ')).toBe('project.noesis.json');
  });
});
