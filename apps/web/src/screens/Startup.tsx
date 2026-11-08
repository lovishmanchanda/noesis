import { useEffect, useState } from 'react';
import markUrl from '../../../../brand/noesis-mark.png';
import { LoadingCard } from '../components/Loading';
import { useEngine } from '../state/engine';

export interface SampleInfo {
  id: string;
  file: string;
  name: string;
  description: string;
  task: 'regression' | 'classification' | 'clustering';
}

export function Startup({
  onNew,
  onSample,
}: {
  onNew: () => void;
  onSample: (sample: SampleInfo) => void;
}) {
  const { phase, progress, error, start } = useEngine();
  const [samples, setSamples] = useState<SampleInfo[]>([]);

  useEffect(() => {
    void start();
  }, [start]);
  useEffect(() => {
    fetch('/samples/samples.json')
      .then((r) => (r.ok ? (r.json() as Promise<SampleInfo[]>) : []))
      .then(setSamples)
      .catch(() => setSamples([]));
  }, []);

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
        <section className="startup-actions">
          <h2>Start</h2>
          <button type="button" className="primary" disabled={!ready} onClick={onNew}>
            New project
          </button>
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
