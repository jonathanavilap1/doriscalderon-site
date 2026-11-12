import { RemovalPolicy } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table, TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
import { Key } from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';

/** DynamoDB tables, all encrypted with one customer-managed KMS key. */
export class Persistence extends Construct {
  readonly key: Key;
  readonly pins: Table;
  readonly classes: Table;
  readonly clubs: Table;
  readonly roster: Table;
  readonly history: Table;

  constructor(scope: Construct, id: string, props: { isProd: boolean }) {
    super(scope, id);
    const removal = props.isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    this.key = new Key(this, 'DataKey', { enableKeyRotation: true, description: 'LM Club data at rest', removalPolicy: removal });

    const table = (name: string, extra: Partial<ConstructorParameters<typeof Table>[2]> & Pick<ConstructorParameters<typeof Table>[2], 'partitionKey'>) =>
      new Table(this, name, {
        billingMode: BillingMode.PAY_PER_REQUEST,
        encryption: TableEncryption.CUSTOMER_MANAGED,
        encryptionKey: this.key,
        removalPolicy: removal,
        ...extra,
      });

    // Ephemeral 4-digit PINs + per-IP brute-force counters. Rows expire via TTL (15 min / 5 min).
    // TTL deletion is lazy (up to ~48h), so application code ALSO checks `expires_at`.
    this.pins = table('Pins', { partitionKey: { name: 'pin', type: AttributeType.STRING }, timeToLiveAttribute: 'expires_at' });
    this.classes = table('Classes', { partitionKey: { name: 'class_id', type: AttributeType.STRING } });
    this.clubs = table('Clubs', { partitionKey: { name: 'club_id', type: AttributeType.STRING }, pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: props.isProd } });
    // Identity plane (UUID -> person). 90-day TTL = data minimisation; erasing it unlinks all telemetry.
    this.roster = table('Roster', {
      partitionKey: { name: 'class_id', type: AttributeType.STRING },
      sortKey: { name: 'athlete_id', type: AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
    });
    this.history = table('History', {
      partitionKey: { name: 'account_id', type: AttributeType.STRING },
      sortKey: { name: 'class_id', type: AttributeType.STRING },
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: props.isProd },
    });
  }
}
