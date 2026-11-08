import { useRef, useState, type DragEvent } from 'react';
import { ColumnTable } from '../components/ColumnTable';
import { Field, Notice, count } from '../components/ui';
import { openFile, reloadWithSettings } from '../state/actions';
import { useEngine } from '../state/engine';
import { useProject } from '../state/project';
import { useUi } from '../state/ui';
import type { SampleInfo } from './Startup';

export function DataScreen({
  samples,
  onSample,
}: {
  samples: SampleInfo[];
  onSample: (s: SampleInfo) => Promise<void>;
}) {
  const { dataset, update } = useProject();
  const mode = useUi((s) => s.mode);
  const ready = useEngine((s) => s.phase === 'ready');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const run = async (job: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await job();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The file could not be read.');
    } finally {
      setBusy(false);
    }
  };
  const takeFile = (file: File | undefined): void => {
    if (!file) return;
    void run(async () =>
      openFile({ name: file.name, bytes: await file.arrayBuffer(), source: 'file' }),
    );
  };
  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    setOver(false);
    takeFile(e.dataTransfer.files[0]);
  };

  if (!dataset) {
    return (
      <div className="stack">
        <div
          className={`drop ${over ? 'over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <p>Drop a CSV file here</p>
          <button type="button" disabled={!ready || busy} onClick={() => input.current?.click()}>
            Choose a file
          </button>
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv,text/plain"
            hidden
            onChange={(e) => takeFile(e.target.files?.[0])}
          />
          <p className="muted small">The file is read on this computer. Nothing is uploaded.</p>
        </div>
        {busy && <p role="status">Reading the file…</p>}
        {error && <Notice kind="error">{error}</Notice>}
        {samples.length > 0 && (
          <div>
            <h2>Or use a sample</h2>
            <div className="sample-grid">
              {samples.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  className="sample"
                  disabled={!ready || busy}
                  onClick={() => void run(() => onSample(s))}
                >
                  <strong>{s.name}</strong>
                  <span className="muted">{s.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const { profile, settings } = dataset;
  return (
    <div className="stack">
      <div className="summary">
        <strong className="mono">{dataset.name}</strong>
        <span className="muted">
          {count(profile.rows)} rows · {profile.columnCount} columns
          {profile.memoryMB != null
            ? ` · ${Math.round(profile.memoryMB * 10) / 10} MB in memory`
            : ''}
        </span>
        <button type="button" onClick={() => update({ dataset: null, splitResult: null })}>
          Choose another file
        </button>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <p className="muted">Check that the columns look right, then continue.</p>
      {mode === 'expert' && (
        <fieldset className="settings">
          <legend>How the file is read</legend>
          <Field label="Separator">
            <select
              value={settings.delimiter ?? ','}
              onChange={(e) =>
                void run(() => reloadWithSettings({ ...settings, delimiter: e.target.value }))
              }
            >
              <option value=",">Comma</option>
              <option value=";">Semicolon</option>
              <option value={'\t'}>Tab</option>
              <option value="|">Bar</option>
            </select>
          </Field>
          <Field label="First row has column names">
            <input
              type="checkbox"
              checked={settings.header !== false}
              onChange={(e) =>
                void run(() => reloadWithSettings({ ...settings, header: e.target.checked }))
              }
            />
          </Field>
          <Field label="Text encoding">
            <select
              value={settings.encoding ?? 'utf-8'}
              onChange={(e) =>
                void run(() => reloadWithSettings({ ...settings, encoding: e.target.value }))
              }
            >
              <option value="utf-8">UTF-8</option>
              <option value="latin-1">Latin-1</option>
              <option value="utf-16">UTF-16</option>
            </select>
          </Field>
        </fieldset>
      )}
      <ColumnTable columns={profile.columns} />
    </div>
  );
}
