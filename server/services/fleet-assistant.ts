import OpenAI from "openai";
import { db } from "../db";
import { trucks, powerMonDevices, deviceSnapshots, alerts, fleets } from "@shared/schema";
import { eq, and, desc, lt, gte } from "drizzle-orm";
import { savingsCalculator } from "./savings-calculator";
import { fleetStatsCalculator } from "./fleet-stats-calculator";

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `You are an AI fleet management assistant for Deecell Power Systems. You help fleet managers monitor and manage their trucks equipped with PowerMon solar battery systems.

Key knowledge about the system:
- PowerMon devices are solar-powered battery systems installed on trucks to reduce engine idling
- SOC (State of Charge) is the battery percentage - above 60% is healthy (green), below is concerning (red)
- Voltage (V) measures battery voltage - typical range is 12-14V
- Power (P) in kW shows current power draw
- Wh (Watt-hours) shows energy consumed
- Ah (Amp-hours) shows charge consumed
- Temperature in °F shows device temperature
- Runtime shows how long the battery can power the sleeper without the engine

Truck statuses:
- "in-service": Truck is actively operating
- "not-in-service": Truck is parked or inactive

Alert types:
- DEVICE_OFFLINE: PowerMon device cannot be reached
- LOW_VOLTAGE: Battery voltage is critically low

When answering questions:
1. Use the available tools to get real-time data - never guess numbers
2. Be concise but helpful
3. If asked about specific trucks, provide relevant metrics
4. Highlight any concerning values (low SOC, offline devices, active alerts)
5. Provide actionable insights when possible

You have access to real-time fleet data through function calls. Always use them to provide accurate information.`;

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_all_trucks",
      description: "Get a list of all trucks in the fleet with their current status and metrics. Use this to answer questions about the fleet, find specific trucks, or get an overview.",
      parameters: {
        type: "object",
        properties: {
          status_filter: {
            type: "string",
            enum: ["all", "in-service", "not-in-service"],
            description: "Filter trucks by status. Default is 'all'."
          }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_truck_details",
      description: "Get detailed information about a specific truck including its PowerMon device metrics.",
      parameters: {
        type: "object",
        properties: {
          truck_identifier: {
            type: "string",
            description: "The truck number/name (e.g., 'FLT-001', 'VAN-002') or truck ID"
          }
        },
        required: ["truck_identifier"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_fleet_statistics",
      description: "Get overall fleet statistics including savings, average SOC, maintenance intervals, and hours offset. Use this for questions about fleet performance, savings, or aggregate metrics.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_active_alerts",
      description: "Get all active (unresolved) alerts for the fleet. Use this to find trucks with problems or check on device issues.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_low_battery_trucks",
      description: "Get trucks with SOC (State of Charge) below a threshold. Default threshold is 60%.",
      parameters: {
        type: "object",
        properties: {
          threshold: {
            type: "number",
            description: "SOC percentage threshold. Trucks below this value will be returned. Default is 60."
          }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_fleet_summary",
      description: "Get a quick summary of the fleet including total trucks, active trucks, trucks with issues, and key metrics.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  }
];

async function executeFunction(name: string, args: Record<string, unknown>, organizationId: number): Promise<string> {
  try {
    switch (name) {
      case "get_all_trucks": {
        const statusFilter = args.status_filter as string || "all";
        
        const truckData = await db
          .select({
            id: trucks.id,
            truckNumber: trucks.truckNumber,
            status: trucks.status,
            driverName: trucks.driverName,
            fleetId: trucks.fleetId,
          })
          .from(trucks)
          .where(eq(trucks.organizationId, organizationId));

        const snapshots = await db
          .select()
          .from(deviceSnapshots)
          .where(eq(deviceSnapshots.organizationId, organizationId));

        const snapshotMap = new Map(snapshots.map(s => [s.truckId, s]));

        let filteredTrucks = truckData;
        if (statusFilter !== "all") {
          filteredTrucks = truckData.filter(t => t.status === statusFilter);
        }

        const result = filteredTrucks.map(t => {
          const snapshot = snapshotMap.get(t.id);
          return {
            truckNumber: t.truckNumber,
            status: t.status,
            driver: t.driverName,
            soc: snapshot?.soc ?? "N/A",
            voltage: snapshot?.voltage2 ?? "N/A",
            power: snapshot?.power ?? "N/A",
            temperature: snapshot?.temperature ?? "N/A",
          };
        });

        return JSON.stringify({
          total: result.length,
          trucks: result
        });
      }

      case "get_truck_details": {
        const identifier = args.truck_identifier as string;
        
        const truck = await db
          .select()
          .from(trucks)
          .where(and(
            eq(trucks.organizationId, organizationId),
            eq(trucks.truckNumber, identifier.toUpperCase())
          ))
          .limit(1);

        if (truck.length === 0) {
          return JSON.stringify({ error: `Truck '${identifier}' not found` });
        }

        const t = truck[0];
        const snapshot = await db
          .select()
          .from(deviceSnapshots)
          .where(and(
            eq(deviceSnapshots.organizationId, organizationId),
            eq(deviceSnapshots.truckId, t.id)
          ))
          .limit(1);

        const device = await db
          .select()
          .from(powerMonDevices)
          .where(and(
            eq(powerMonDevices.organizationId, organizationId),
            eq(powerMonDevices.truckId, t.id)
          ))
          .limit(1);

        const truckAlerts = await db
          .select()
          .from(alerts)
          .where(and(
            eq(alerts.organizationId, organizationId),
            eq(alerts.truckId, t.id),
            eq(alerts.status, "active")
          ));

        const s = snapshot[0];
        const d = device[0];

        return JSON.stringify({
          truckNumber: t.truckNumber,
          status: t.status,
          driver: t.driverName,
          location: `${t.latitude}, ${t.longitude}`,
          device: d ? {
            serial: d.serialNumber,
            status: d.status,
            firmware: d.firmwareVersion
          } : null,
          metrics: s ? {
            soc: `${s.soc}%`,
            voltage: `${s.voltage2?.toFixed(2)}V`,
            power: `${s.power?.toFixed(1)}kW`,
            energy: `${s.energy?.toFixed(0)}Wh`,
            temperature: `${s.temperature?.toFixed(1)}°F`,
            runtime: `${s.runtime} minutes`
          } : "No data available",
          activeAlerts: truckAlerts.length > 0 ? truckAlerts.map(a => ({
            type: a.alertType,
            severity: a.severity,
            message: a.message
          })) : "None"
        });
      }

      case "get_fleet_statistics": {
        const [savings, stats] = await Promise.all([
          savingsCalculator.calculateSavings(organizationId),
          fleetStatsCalculator.calculateFleetStats(organizationId)
        ]);

        return JSON.stringify({
          todaysSavings: `$${savings.todaySavings.toFixed(2)}`,
          fuelPriceUsed: `$${savings.currentFuelPrice.toFixed(2)}/gallon`,
          last7DayAverage: `$${savings.last7DaysAverage.toFixed(2)}`,
          averageSOC: `${stats.avgSoc.value}%`,
          tractorHoursOffset: `${stats.tractorHoursOffset.hours}:${stats.tractorHoursOffset.minutes.toString().padStart(2, '0')} hours`,
          maintenanceIntervalIncrease: `${stats.maintenanceIntervalIncrease.value}%`
        });
      }

      case "get_active_alerts": {
        const activeAlerts = await db
          .select({
            id: alerts.id,
            type: alerts.alertType,
            severity: alerts.severity,
            message: alerts.message,
            truckId: alerts.truckId,
            createdAt: alerts.createdAt
          })
          .from(alerts)
          .where(and(
            eq(alerts.organizationId, organizationId),
            eq(alerts.status, "active")
          ))
          .orderBy(desc(alerts.createdAt));

        if (activeAlerts.length === 0) {
          return JSON.stringify({ message: "No active alerts. All systems are operating normally." });
        }

        const truckIds = Array.from(new Set(activeAlerts.map(a => a.truckId).filter(Boolean)));
        const truckData = truckIds.length > 0 ? await db
          .select({ id: trucks.id, truckNumber: trucks.truckNumber })
          .from(trucks)
          .where(eq(trucks.organizationId, organizationId)) : [];
        
        const truckMap = new Map(truckData.map(t => [t.id, t.truckNumber]));

        return JSON.stringify({
          totalAlerts: activeAlerts.length,
          alerts: activeAlerts.map(a => ({
            type: a.type,
            severity: a.severity,
            message: a.message,
            truck: a.truckId ? truckMap.get(a.truckId) || "Unknown" : "N/A"
          }))
        });
      }

      case "get_low_battery_trucks": {
        const threshold = (args.threshold as number) || 60;

        const snapshots = await db
          .select()
          .from(deviceSnapshots)
          .where(and(
            eq(deviceSnapshots.organizationId, organizationId),
            lt(deviceSnapshots.soc, threshold)
          ));

        if (snapshots.length === 0) {
          return JSON.stringify({ message: `No trucks with SOC below ${threshold}%. All batteries are healthy.` });
        }

        const truckIds = snapshots.map(s => s.truckId).filter(Boolean) as number[];
        const truckData = await db
          .select({ id: trucks.id, truckNumber: trucks.truckNumber, driverName: trucks.driverName })
          .from(trucks)
          .where(eq(trucks.organizationId, organizationId));
        
        const truckMap = new Map(truckData.map(t => [t.id, t]));

        return JSON.stringify({
          threshold: `${threshold}%`,
          count: snapshots.length,
          trucks: snapshots.map(s => {
            const t = truckMap.get(s.truckId!);
            return {
              truckNumber: t?.truckNumber || "Unknown",
              driver: t?.driverName || "Unknown",
              soc: `${s.soc}%`,
              voltage: `${s.voltage2?.toFixed(2)}V`
            };
          })
        });
      }

      case "get_fleet_summary": {
        const allTrucks = await db
          .select()
          .from(trucks)
          .where(eq(trucks.organizationId, organizationId));

        const snapshots = await db
          .select()
          .from(deviceSnapshots)
          .where(eq(deviceSnapshots.organizationId, organizationId));

        const activeAlerts = await db
          .select()
          .from(alerts)
          .where(and(
            eq(alerts.organizationId, organizationId),
            eq(alerts.status, "active")
          ));

        const inService = allTrucks.filter(t => t.status === "in-service").length;
        const lowBattery = snapshots.filter(s => s.soc !== null && s.soc < 60).length;
        const avgSoc = snapshots.length > 0 
          ? snapshots.reduce((sum, s) => sum + (s.soc || 0), 0) / snapshots.length 
          : 0;

        return JSON.stringify({
          totalTrucks: allTrucks.length,
          inService: inService,
          notInService: allTrucks.length - inService,
          averageSOC: `${avgSoc.toFixed(0)}%`,
          trucksWithLowBattery: lowBattery,
          activeAlerts: activeAlerts.length,
          status: activeAlerts.length === 0 && lowBattery === 0 ? "All systems healthy" : "Attention needed"
        });
      }

      default:
        return JSON.stringify({ error: `Unknown function: ${name}` });
    }
  } catch (error) {
    console.error(`[FleetAssistant] Error executing ${name}:`, error);
    return JSON.stringify({ error: `Failed to execute ${name}` });
  }
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const VALID_FUNCTIONS = new Set([
  "get_all_trucks",
  "get_truck_details", 
  "get_fleet_statistics",
  "get_active_alerts",
  "get_low_battery_trucks",
  "get_fleet_summary"
]);

const MAX_TOOL_ITERATIONS = 5;

export async function processChat(
  messages: ChatMessage[],
  organizationId: number
): Promise<string> {
  try {
    const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content }))
    ];

    let response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: openaiMessages,
      tools: tools,
      tool_choice: "auto",
    });

    let assistantMessage = response.choices[0].message;
    let iterations = 0;

    while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      iterations++;
      if (iterations > MAX_TOOL_ITERATIONS) {
        console.warn(`[FleetAssistant] Max tool iterations (${MAX_TOOL_ITERATIONS}) reached, stopping`);
        return "I've gathered enough information. Let me summarize what I found.";
      }

      openaiMessages.push(assistantMessage);

      for (const toolCall of assistantMessage.tool_calls) {
        if (toolCall.type !== "function") continue;
        
        const functionName = toolCall.function.name;
        
        if (!VALID_FUNCTIONS.has(functionName)) {
          console.warn(`[FleetAssistant] Invalid function name: ${functionName}`);
          openaiMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: `Unknown function: ${functionName}` }),
          });
          continue;
        }

        let functionArgs: Record<string, unknown> = {};
        try {
          functionArgs = JSON.parse(toolCall.function.arguments || "{}");
        } catch (parseError) {
          console.warn(`[FleetAssistant] Failed to parse function args: ${toolCall.function.arguments}`);
          openaiMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: "Invalid function arguments" }),
          });
          continue;
        }
        
        console.log(`[FleetAssistant] Calling function: ${functionName}`, functionArgs);
        
        const result = await executeFunction(functionName, functionArgs, organizationId);
        
        openaiMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }

      response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: openaiMessages,
        tools: tools,
        tool_choice: "auto",
      });

      assistantMessage = response.choices[0].message;
    }

    return assistantMessage.content || "I couldn't generate a response. Please try again.";
  } catch (error: unknown) {
    console.error("[FleetAssistant] Error processing chat:", error);
    
    if (error instanceof Error) {
      if (error.message.includes("API key")) {
        return "I'm having trouble connecting to my AI service. Please try again later.";
      }
      if (error.message.includes("rate limit")) {
        return "I'm receiving too many requests right now. Please wait a moment and try again.";
      }
    }
    
    return "I encountered an unexpected error. Please try again.";
  }
}
