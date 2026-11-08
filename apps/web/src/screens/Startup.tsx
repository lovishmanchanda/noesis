import { useEffect, useRef, useState } from 'react';
import markUrl from '../../../../brand/noesis-mark.png';
import { LoadingCard } from '../components/Loading';
import { Notice } from '../components/ui';
import { useEngine } from '../state/engine';
import type { SavedProject } from '../state/persist';

export interface SampleInfo {
  id: string;
  file: string;
  name: string;
  description: string;
  goal: 'number' | 'category' | 'groups';
  target?: string;
  exclude?: string[];
  reference?: string;
}

export interface StartupProps {
  samples: SampleInfo[];
  saved: SavedProject | null;
  message: string | null;
  onNew: () => void;
  onSample: (sample: SampleInfo) => void;
  onContinue: () => void;
  onDiscard: () => void;
  onOpenFile: (file: File) => void;
}

export function Startup({
  samples,
  saved,
  message,
  onNew,
  onSample,
  onContinue,
  onDiscard,
  onOpenFile,
}: StartupProps) {
  const { phase, progress, error, start } = useEngine();
  const input = useRef<HTMLInputElement>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    void start();
  }, [start]);

  const ready = phase === 'ready';
  return (
    <div className="startup">
      <div className="startup-inner">
        <header className="startup-brand">
          <img src={markUrl} alt="" width={56} height={32} />
          <h1 className="wordmark big">NOESIS</h1>
        </header>
        <p className="lead">
          Train and check machine learning models from a CSV file, step by step. Everything runs on
          this computer.
        </p>
        <LoadingCard progress={progress} error={error} onRetry={() => void start()} />
        {message && <Notice kind="error">{message}</Notice>}
        <section className="startup-actions">
          {saved && (
            <div className="card continue">
              <div>
                <strong>{saved.project.name}</strong>
                <span className="muted block small">
                  Saved on this device{' '}
                  {new Date(saved.savedAt).toLocaleString('en-GB', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </span>
              </div>
              <div className="row">
                <button type="button" className="primary" disabled={!ready} onClick={onContinue}>
                  Continue
                </button>
                {confirmDiscard ? (
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDiscard(false);
                      onDiscard();
                    }}
                  >
                    Yes, discard it
                  </button>
                ) : (
                  <button type="button" onClick={() => setConfirmDiscard(true)}>
                    Discard
                  </button>
                )}
              </div>
            </div>
          )}
          <h2>Start</h2>
          <div className="row">
            <button
              type="button"
              className={saved ? '' : 'primary'}
              disabled={!ready}
              onClick={onNew}
            >
              New project
            </button>
            <button type="button" onClick={() => input.current?.click()}>
              Open a project file
            </button>
            <input
              ref={input}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onOpenFile(f);
                e.target.value = '';
              }}
            />
          </div>
          <h2 className="mt">Or try a sample dataset</h2>
          <div className="sample-grid">
            {samples.map((s) => (
              <button
                type="button"
                key={s.id}
                className="sample"
                disabled={!ready}
                onClick={() => onSample(s)}
              >
                <strong>{s.name}</strong>
                <span className="muted">{s.description}</span>
              </button>
            ))}
          </div>
          {!ready && !error && (
            <p className="muted small">The buttons turn on when the engine is ready.</p>
          )}
        </section>
      </div>
    </div>
  );
}
