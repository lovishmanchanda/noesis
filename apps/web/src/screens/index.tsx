import type { ReactNode } from 'react';
import type { ScreenId } from '../screens';
import { DataScreen } from './DataScreen';
import { ProjectScreen } from './ProjectScreen';
import { SplitScreen } from './SplitScreen';
import type { SampleInfo } from './Startup';
import { TargetScreen } from './TargetScreen';
import { TidyScreen } from './TidyScreen';

export function renderScreen(
  id: ScreenId,
  samples: SampleInfo[],
  onSample: (s: SampleInfo) => Promise<void>,
): ReactNode {
  switch (id) {
    case 'project':
      return <ProjectScreen />;
    case 'data':
      return <DataScreen samples={samples} onSample={onSample} />;
    case 'target':
      return <TargetScreen />;
    case 'tidy':
      return <TidyScreen />;
    case 'split':
      return <SplitScreen />;
    default:
      return <p className="muted">This screen arrives in a later version.</p>;
  }
}
