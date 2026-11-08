/** Turns the engine's technical error text into a sentence a person can act on. */
export function friendlyError(name: string, message: string): string {
  const ragged = /Expected (\d+) fields in line (\d+), saw (\d+)/.exec(message);
  if (ragged) {
    return `Line ${ragged[2]} has ${ragged[3]} values, but the first line has ${ragged[1]}. Check the separator in the settings, or fix that line in the file.`;
  }
  if (/EmptyDataError|No columns to parse/.test(`${name} ${message}`)) return 'The file is empty.';
  if (/UnicodeDecodeError|codec can't decode/.test(`${name} ${message}`)) {
    return 'The text in the file could not be read. Try another text encoding (Expert mode, "How the file is read").';
  }
  if (/MemoryError|out of memory|Cannot enlarge memory/i.test(`${name} ${message}`)) {
    return 'The file is too big for this computer to hold in the browser. Try a smaller sample of the rows.';
  }
  if (/KeyError/.test(name)) return message.replace(/^KeyError:\s*/, '').replace(/^"|"$/g, '');
  const cleaned = message.replace(/^[\w.]*(Error|Exception):\s*/, '').trim();
  return cleaned || 'Something went wrong while reading the file.';
}
