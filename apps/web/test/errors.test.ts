import { describe, expect, it } from 'vitest';
import { friendlyError } from '../src/engine/errors';

describe('friendlyError', () => {
  it('explains a ragged line', () => {
    const text = friendlyError(
      'ParserError',
      'pandas.errors.ParserError: Error tokenizing data. C error: Expected 2 fields in line 3, saw 5',
    );
    expect(text).toBe(
      'Line 3 has 5 values, but the first line has 2. Check the separator in the settings, or fix that line in the file.',
    );
  });
  it('explains an empty file, bad text and memory problems', () => {
    expect(friendlyError('EmptyDataError', 'No columns to parse from file')).toBe(
      'The file is empty.',
    );
    expect(friendlyError('UnicodeDecodeError', "'utf-8' codec can't decode byte 0xe9")).toMatch(
      /text encoding/,
    );
    expect(friendlyError('Error', 'Cannot enlarge memory arrays')).toMatch(/too big/);
  });
  it('shows a missing column plainly and strips technical prefixes from anything else', () => {
    expect(friendlyError('KeyError', "KeyError: 'drop_columns: no such column age'")).toBe(
      "'drop_columns: no such column age'",
    );
    expect(friendlyError('ValueError', 'ValueError: The split left the training part empty')).toBe(
      'The split left the training part empty',
    );
    expect(friendlyError('Error', '')).toMatch(/Something went wrong/);
  });
});
