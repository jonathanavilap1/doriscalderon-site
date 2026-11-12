import { Stack, StackProps, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Api } from './api';
import { Persistence } from './persistence';
import { Telemetry } from './telemetry';

export interface LmClubStackProps extends StackProps {
  stage: string;
  tvOrigin: string;
}

export class LmClubStack extends Stack {
  constructor(scope: Construct, id: string, props: LmClubStackProps) {
    super(scope, id, props);
    const isProd = props.stage === 'prod';

    const persistence = new Persistence(this, 'Persistence', { isProd });
    const telemetry = new Telemetry(this, 'Telemetry', { key: persistence.key, isProd });
    new Api(this, 'Api', { persistence, telemetry, tvOrigin: props.tvOrigin, isProd });

    Tags.of(this).add('app', 'lm-club');
    Tags.of(this).add('stage', props.stage);
  }
}
