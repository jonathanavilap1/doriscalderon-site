const must = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
};

/** Lazily read so unit tests can import modules without a full Lambda environment. */
export const config = {
  get region() { return must('AWS_REGION'); },
  get accountId() { return must('ACCOUNT_ID'); },
  get secretArn() { return must('JWT_SECRET_ARN'); },
  get iotEndpoint() { return must('IOT_ENDPOINT'); },
  get authorizerName() { return must('IOT_AUTHORIZER_NAME'); },
  get eventBusName() { return must('EVENT_BUS_NAME'); },
  get pinsTable() { return must('PINS_TABLE'); },
  get classesTable() { return must('CLASSES_TABLE'); },
  get clubsTable() { return must('CLUBS_TABLE'); },
  get rosterTable() { return must('ROSTER_TABLE'); },
  get historyTable() { return must('HISTORY_TABLE'); },
  get tsDatabase() { return must('TS_DATABASE'); },
  get tsRawTable() { return must('TS_RAW_TABLE'); },
  get tsAggTable() { return must('TS_AGG_TABLE'); },
  pinTtlSeconds: 15 * 60,
  tvTokenTtlSeconds: 6 * 3600,
  athleteTokenTtlSeconds: 3 * 3600,
  rosterRetentionSeconds: 90 * 24 * 3600,
};
