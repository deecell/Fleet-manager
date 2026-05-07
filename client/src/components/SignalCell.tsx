import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const NO_READING_SENTINEL = -32768;

export type SignalQuality = "excellent" | "good" | "fair" | "poor" | "unknown";

export function classifySignal(rssi: number | null | undefined): SignalQuality {
  if (rssi == null || rssi === NO_READING_SENTINEL) return "unknown";
  if (rssi >= -70) return "excellent";
  if (rssi >= -85) return "good";
  if (rssi >= -100) return "fair";
  return "poor";
}

const QUALITY_COLOR: Record<SignalQuality, string> = {
  excellent: "text-[#00a63e]",
  good:      "text-[#4a5565]",
  fair:      "text-[#e6b800]",
  poor:      "text-[#cc0000]",
  unknown:   "text-[#9c9ca7]",
};

const QUALITY_LABEL: Record<SignalQuality, string> = {
  excellent: "Excellent",
  good:      "Good",
  fair:      "Fair",
  poor:      "Poor",
  unknown:   "No reading",
};

interface Props {
  rssi: number | null | undefined;
  testId?: string;
}

/**
 * Renders a cellular RSSI value as color-coded `-XX dBm`, or `—` when the
 * device has no reading (null) or reports the PowerMon "no reading" sentinel
 * (-32768). Hover shows the qualitative label.
 *
 * Thresholds (cellular, dBm):
 *   >= -70  excellent (green)
 *   >= -85  good      (default)
 *   >= -100 fair      (amber)
 *    < -100 poor      (red)
 */
export function SignalCell({ rssi, testId }: Props) {
  const quality = classifySignal(rssi);
  const colorClass = QUALITY_COLOR[quality];

  if (quality === "unknown") {
    return (
      <span
        className={`text-[13px] tabular-nums ${colorClass}`}
        data-testid={testId}
      >
        —
      </span>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`text-[13px] font-medium tabular-nums whitespace-nowrap ${colorClass}`}
          data-testid={testId}
        >
          {rssi} dBm
        </span>
      </TooltipTrigger>
      <TooltipContent>{QUALITY_LABEL[quality]}</TooltipContent>
    </Tooltip>
  );
}
