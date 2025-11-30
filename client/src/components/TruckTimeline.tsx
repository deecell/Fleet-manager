import { format, formatDistanceToNow } from "date-fns";
import { AlertTriangle, Bell, CheckCircle2, Clock, MapPin, Settings, Truck, Wrench, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useTruckEvents, type TruckEvent } from "@/lib/api";
import { cn } from "@/lib/utils";

interface TruckTimelineProps {
  truckId: number;
}

function getEventIcon(event: TruckEvent) {
  switch (event.type) {
    case "alert":
      if (event.severity === "critical") return <XCircle className="w-4 h-4" />;
      if (event.severity === "warning") return <AlertTriangle className="w-4 h-4" />;
      return <Bell className="w-4 h-4" />;
    case "maintenance":
      return <Wrench className="w-4 h-4" />;
    case "route":
      return <MapPin className="w-4 h-4" />;
    case "status":
      return <Settings className="w-4 h-4" />;
    default:
      return <Clock className="w-4 h-4" />;
  }
}

function getEventColor(event: TruckEvent): string {
  if (event.status === "resolved") return "bg-green-500";
  if (event.status === "acknowledged") return "bg-blue-500";
  
  switch (event.severity) {
    case "critical": return "bg-red-500";
    case "warning": return "bg-amber-500";
    case "info": return "bg-blue-500";
    default: return "bg-slate-500";
  }
}

function getEventBadgeVariant(event: TruckEvent): "default" | "secondary" | "destructive" | "outline" {
  if (event.status === "resolved") return "secondary";
  if (event.severity === "critical") return "destructive";
  return "outline";
}

function TimelineEvent({ event, isLast }: { event: TruckEvent; isLast: boolean }) {
  const timestamp = typeof event.timestamp === "string" ? new Date(event.timestamp) : event.timestamp;
  const isResolved = event.status === "resolved";
  
  return (
    <div className={cn("flex gap-3 relative", !isLast && "pb-6")} data-testid={`timeline-event-${event.id}`}>
      <div className="flex flex-col items-center">
        <div className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0",
          getEventColor(event),
          isResolved && "opacity-60"
        )}>
          {isResolved ? <CheckCircle2 className="w-4 h-4" /> : getEventIcon(event)}
        </div>
        {!isLast && <div className="w-0.5 bg-border flex-1 mt-2" />}
      </div>
      
      <div className={cn("flex-1 pb-2", isResolved && "opacity-70")}>
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className={cn(
              "font-medium text-sm",
              isResolved && "line-through"
            )}>
              {event.title}
            </h4>
            <Badge variant={getEventBadgeVariant(event)} className="text-xs capitalize">
              {event.status || event.severity || event.type}
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {formatDistanceToNow(timestamp, { addSuffix: true })}
          </span>
        </div>
        
        {event.description && (
          <p className="text-sm text-muted-foreground mb-1">{event.description}</p>
        )}
        
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {format(timestamp, "MMM d, yyyy 'at' h:mm a")}
          </span>
          {event.resolvedAt && (
            <span className="flex items-center gap-1 text-green-600">
              <CheckCircle2 className="w-3 h-3" />
              Resolved {formatDistanceToNow(new Date(event.resolvedAt), { addSuffix: true })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function TimelineLoading() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="w-8 h-8 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyTimeline() {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <Truck className="w-12 h-12 text-muted-foreground mb-3" />
      <h4 className="font-medium text-muted-foreground">No events yet</h4>
      <p className="text-sm text-muted-foreground">
        Events like alerts, maintenance, and status changes will appear here
      </p>
    </div>
  );
}

export function TruckTimeline({ truckId }: TruckTimelineProps) {
  const { data, isLoading, isError } = useTruckEvents(truckId, { limit: 20 });
  
  return (
    <Card className="bg-[#FAFBFC]" data-testid="card-truck-timeline">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Clock className="w-4 h-4" />
          Event Timeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <TimelineLoading />
        ) : isError ? (
          <div className="text-sm text-red-500 text-center py-4">
            Failed to load events
          </div>
        ) : !data?.events || data.events.length === 0 ? (
          <EmptyTimeline />
        ) : (
          <div className="relative">
            {data.events.map((event, index) => (
              <TimelineEvent 
                key={event.id} 
                event={event} 
                isLast={index === data.events.length - 1} 
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
