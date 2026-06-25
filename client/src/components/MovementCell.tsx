import { Navigation, ParkingCircle } from "lucide-react";

interface Props {
  miles?: number | null;
  testId?: string;
}

// A parked truck's GPS still jitters by up to ~0.2 mi (observed: two trucks
// sitting side-by-side in the same shop, one reading 0.17 mi of spread). Anything
// below this is treated as "Parked" so jitter never reads as a real trip.
const MOVED_THRESHOLD_MILES = 0.2;

function formatMiles(miles: number): string {
  if (miles < 10) return miles.toFixed(1);
  return Math.round(miles).toString();
}

/**
 * Renders how far a truck has moved in the last 24 hours: a green distance with a
 * navigation icon when it actually drove, a muted "Parked" when it stayed put,
 * and "—" when there's no GPS data in the window (no truck assigned or no fixes).
 */
export function MovementCell({ miles, testId }: Props) {
  if (miles == null) {
    return (
      <span className="text-[13px] text-[#9c9ca7]" data-testid={testId}>
        —
      </span>
    );
  }

  if (miles < MOVED_THRESHOLD_MILES) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[13px] text-[#9c9ca7]"
        data-testid={testId}
      >
        <ParkingCircle className="h-3.5 w-3.5" />
        Parked
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 text-[13px] font-medium text-[#16a34a]"
      data-testid={testId}
    >
      <Navigation className="h-3.5 w-3.5" />
      {formatMiles(miles)} mi
    </span>
  );
}
