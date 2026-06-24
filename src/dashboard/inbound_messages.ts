export interface InboundMessagePoint {
  readonly count: number;
  readonly label: string;
  readonly timestamp: string;
}

export interface InboundMessageSeries {
  readonly points: readonly InboundMessagePoint[];
  readonly total: number;
  readonly windowMinutes: number;
}

export interface DashboardRuntimeActivity {
  readonly lastPatchAt: Date | undefined;
  readonly lastReceivedAt: Date | undefined;
}

export interface InboundMessageTracker {
  recordMessage(receivedAt?: Date): void;
  recordPatch(patchedAt?: Date): void;
  readActivity(): DashboardRuntimeActivity;
  readSeries(): InboundMessageSeries;
}

const DEFAULT_WINDOW_MINUTES = 60;
const MILLISECONDS_PER_MINUTE = 60_000;

export function createInboundMessageTracker(
  windowMinutes = DEFAULT_WINDOW_MINUTES,
): InboundMessageTracker {
  const buckets = new Map<number, number>();
  const normalizedWindowMinutes = Math.max(1, Math.floor(windowMinutes));
  let lastPatchAt: Date | undefined;
  let lastReceivedAt: Date | undefined;

  return {
    recordMessage(receivedAt = new Date()): void {
      lastReceivedAt = receivedAt;
      const bucket = readMinuteBucket(receivedAt);
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
      pruneBuckets(buckets, bucket, normalizedWindowMinutes);
    },
    recordPatch(patchedAt = new Date()): void {
      lastPatchAt = patchedAt;
    },
    readActivity(): DashboardRuntimeActivity {
      return {
        lastPatchAt,
        lastReceivedAt,
      };
    },
    readSeries(): InboundMessageSeries {
      const nowBucket = readMinuteBucket(new Date());
      pruneBuckets(buckets, nowBucket, normalizedWindowMinutes);

      const points: InboundMessagePoint[] = [];
      let total = 0;

      for (
        let bucket = nowBucket - normalizedWindowMinutes + 1;
        bucket <= nowBucket;
        bucket += 1
      ) {
        const count = buckets.get(bucket) ?? 0;
        total += count;
        points.push({
          count,
          label: formatBucketLabel(bucket),
          timestamp: new Date(bucket * MILLISECONDS_PER_MINUTE).toISOString(),
        });
      }

      return {
        points,
        total,
        windowMinutes: normalizedWindowMinutes,
      };
    },
  };
}

function readMinuteBucket(date: Date): number {
  return Math.floor(date.valueOf() / MILLISECONDS_PER_MINUTE);
}

function pruneBuckets(
  buckets: Map<number, number>,
  nowBucket: number,
  windowMinutes: number,
): void {
  const oldestBucket = nowBucket - windowMinutes + 1;

  for (const bucket of buckets.keys()) {
    if (bucket < oldestBucket) {
      buckets.delete(bucket);
    }
  }
}

function formatBucketLabel(bucket: number): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(bucket * MILLISECONDS_PER_MINUTE));
}
