import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  latitude?: number | null;
  longitude?: number | null;
  locationDescription?: string | null;
  lastLocationUpdate?: string | Date | null;
  testId?: string;
}

function formatAge(updatedAt: string | Date | null | undefined): { label: string; stale: boolean } | null {
  if (!updatedAt) return null;
  const then = new Date(updatedAt).getTime();
  if (Number.isNaN(then)) return null;
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return { label: "just now", stale: false };
  if (mins < 60) return { label: `${mins}m ago`, stale: mins > 10 };
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return { label: `${hrs}h ago`, stale: true };
  return { label: `${Math.floor(hrs / 24)}d ago`, stale: true };
}

/**
 * Renders a truck's latest GPS location: a human-readable address linking to
 * Google Maps, the raw lat/lng (so coarse jitter is visible at a glance), and a
 * freshness line ("x min ago") that greys out when the fix is stale. Shows "—"
 * when there are no coordinates (no truck assigned or no GPS fix yet).
 *
 * The InHand router reports a fix on each ~2-min poll, so a healthy truck should
 * stay within a few minutes of "now"; a stale age means the router stopped
 * reporting GPS.
 */
export function LocationCell({ latitude, longitude, locationDescription, lastLocationUpdate, testId }: Props) {
  if (latitude == null || longitude == null) {
    return (
      <span className="text-[13px] text-[#9c9ca7]" data-testid={testId}>
        —
      </span>
    );
  }

  const coords = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  const mapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
  const age = formatAge(lastLocationUpdate);

  return (
    <div className="flex flex-col leading-tight" data-testid={testId}>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] font-medium text-[#2563eb] hover:underline max-w-[180px] truncate"
            data-testid={testId ? `${testId}-link` : undefined}
          >
            {locationDescription || coords}
          </a>
        </TooltipTrigger>
        <TooltipContent>
          <div className="flex flex-col gap-0.5">
            {locationDescription && <span>{locationDescription}</span>}
            <span className="tabular-nums">{coords}</span>
            <span className="text-muted-foreground">Open in Google Maps</span>
          </div>
        </TooltipContent>
      </Tooltip>
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {coords}
        {age && (
          <span className={age.stale ? "text-[#cc8400]" : "text-[#9c9ca7]"}> · {age.label}</span>
        )}
      </span>
    </div>
  );
}
