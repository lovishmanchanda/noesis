export interface MetricInfo {
  label: string;
  higherIsBetter: boolean;
  /** One line a person can read. */
  meaning: string;
}

export const METRICS: Record<string, MetricInfo> = {
  rmse: {
    label: 'RMSE',
    higherIsBetter: false,
    meaning: 'Typical size of the error, in the units of the target. Lower is better.',
  },
  mae: {
    label: 'MAE',
    higherIsBetter: false,
    meaning: 'Average size of the error. Lower is better.',
  },
  mape: {
    label: 'MAPE',
    higherIsBetter: false,
    meaning: 'Average error as a share of the true value. Lower is better.',
  },
  r2: {
    label: 'R²',
    higherIsBetter: true,
    meaning:
      'Share of the variation the model explains. 1 is perfect, 0 is no better than the average.',
  },
  accuracy: {
    label: 'Accuracy',
    higherIsBetter: true,
    meaning: 'Share of rows predicted correctly.',
  },
  f1: {
    label: 'F1',
    higherIsBetter: true,
    meaning: 'Balance of catching the rare class and not raising false alarms.',
  },
  precision: {
    label: 'Precision',
    higherIsBetter: true,
    meaning: 'Of the rows flagged, the share that were right.',
  },
  recall: {
    label: 'Recall',
    higherIsBetter: true,
    meaning: 'Of the rows that matter, the share that were found.',
  },
  roc_auc: {
    label: 'ROC AUC',
    higherIsBetter: true,
    meaning: 'How well the model ranks positive rows above negative ones.',
  },
  pr_auc: {
    label: 'PR AUC',
    higherIsBetter: true,
    meaning: 'Ranking quality when the positive class is rare.',
  },
  log_loss: {
    label: 'Log loss',
    higherIsBetter: false,
    meaning: 'How confident and how wrong the predicted probabilities are. Lower is better.',
  },
  silhouette: {
    label: 'Silhouette',
    higherIsBetter: true,
    meaning: 'How well separated the groups are.',
  },
};

export const metricInfo = (name: string): MetricInfo =>
  METRICS[name] ?? { label: name, higherIsBetter: true, meaning: '' };

/** True when score `a` is better than `b` for this metric. Missing scores are never better. */
export function isBetter(
  a: number | null | undefined,
  b: number | null | undefined,
  metric: string,
): boolean {
  if (a === null || a === undefined) return false;
  if (b === null || b === undefined) return true;
  return metricInfo(metric).higherIsBetter ? a > b : a < b;
}

export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return '–';
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toLocaleString('en-GB', { maximumFractionDigits: 0 });
  if (abs >= 10) return value.toFixed(2);
  return value.toFixed(3);
}
