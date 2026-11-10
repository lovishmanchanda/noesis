import type { ReactNode } from 'react';
import type { ScreenId } from '../screens';
import { DataScreen } from './DataScreen';
import { ExploreScreen } from './ExploreScreen';
import { FeaturesScreen } from './FeaturesScreen';
import { MissingScreen } from './MissingScreen';
import { CompareScreen } from './CompareScreen';
import { ModelScreen } from './ModelScreen';
import { TrainScreen } from './TrainScreen';
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
    case 'explore':
      return <ExploreScreen />;
    case 'missing':
      return <MissingScreen />;
    case 'features':
      return <FeaturesScreen />;
    case 'model':
      return <ModelScreen />;
    case 'train':
      return <TrainScreen />;
    case 'compare':
      return <CompareScreen />;
    default:
      return <p className="muted">This screen arrives in a later version.</p>;
  }
}
