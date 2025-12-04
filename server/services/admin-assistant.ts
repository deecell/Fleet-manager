import OpenAI from "openai";
import { db } from "../db";
import { organizations, fleets, trucks, powerMonDevices, deviceSnapshots, users, alerts } from "@shared/schema";
import { eq, desc, count, sql, isNull, not, and, lt } from "drizzle-orm";

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OpenAI API key not configured. Set AI_INTEGRATIONS_OPENAI_API_KEY or OPENAI_API_KEY environment variable.");
    }
    openaiClient = new OpenAI({
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      apiKey: apiKey,
    });
  }
  return openaiClient;
}

const ADMIN_SYSTEM_PROMPT = `You are Ray Ray, an AI assistant for Deecell Power Systems administrators. You help admins manage the entire platform across all organizations.

You have access to cross-organizational data including:
- All organizations and their details
- All fleets across all organizations
- All trucks and PowerMon devices system-wide
- All users and their organization assignments
- System-wide alerts and device health

Key metrics to understand:
- SOC (State of Charge): Battery percentage. Above 60% is healthy.
- Device status: Online/offline based on recent communication
- Parked vs Driving: Based on chassis voltage (< 13V = parked)

When answering questions:
1. Use the available tools to get real-time data - never guess numbers
2. Provide system-wide insights and statistics
3. Identify issues across organizations (offline devices, low batteries)
4. Be concise but thorough for administrative decisions
5. Help with user management and organization oversight

You have access to admin-level data through function calls. Always use them for accurate information.`;

const adminTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_system_overview",
      description: "Get a high-level overview of the entire system: total organizations, fleets, trucks, devices, and users.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "list_organizations",
      description: "List all organizations with their fleet and truck counts.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "get_organization_details",
      description: "Get detailed information about a specific organization including its fleets, trucks, and users.",
      parameters: {
        type: "object",
        properties: {
          organization_name: {
            type: "string",
            description: "The name or ID of the organization"
          }
        },
        required: ["organization_name"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_all_devices_status",
      description: "Get status of all PowerMon devices across all organizations, optionally filtered by status.",
      parameters: {
        type: "object",
        properties: {
          status_filter: {
            type: "string",
            enum: ["all", "online", "offline"],
            description: "Filter devices by status. Default is 'all'."
          }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_cross_org_alerts",
      description: "Get all active alerts across all organizations.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "get_user_stats",
      description: "Get statistics about users across all organizations.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "get_low_battery_devices",
      description: "Get all devices with low battery (SOC below threshold) across all organizations.",
      parameters: {
        type: "object",
        properties: {
          threshold: {
            type: "number",
            description: "SOC percentage threshold. Default is 60."
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
      description: "Get a summary of all fleets across all organizations.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  }
];

async function getSystemOverview() {
  const [orgCount] = await db.select({ count: count() }).from(organizations);
  const [fleetCount] = await db.select({ count: count() }).from(fleets);
  const [truckCount] = await db.select({ count: count() }).from(trucks);
  const [deviceCount] = await db.select({ count: count() }).from(powerMonDevices);
  const [userCount] = await db.select({ count: count() }).from(users);
  const [alertCount] = await db.select({ count: count() }).from(alerts).where(not(eq(alerts.status, "resolved")));

  return {
    totalOrganizations: orgCount.count,
    totalFleets: fleetCount.count,
    totalTrucks: truckCount.count,
    totalDevices: deviceCount.count,
    totalUsers: userCount.count,
    activeAlerts: alertCount.count
  };
}

async function listOrganizations() {
  const orgs = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      plan: organizations.plan,
      isActive: organizations.isActive,
      createdAt: organizations.createdAt
    })
    .from(organizations)
    .orderBy(organizations.name);

  const orgsWithCounts = await Promise.all(
    orgs.map(async (org) => {
      const [fleetCount] = await db.select({ count: count() }).from(fleets).where(eq(fleets.organizationId, org.id));
      const [truckCount] = await db.select({ count: count() }).from(trucks).where(eq(trucks.organizationId, org.id));
      const [deviceCount] = await db.select({ count: count() }).from(powerMonDevices).where(eq(powerMonDevices.organizationId, org.id));
      const [userCount] = await db.select({ count: count() }).from(users).where(eq(users.organizationId, org.id));
      
      return {
        ...org,
        fleetCount: fleetCount.count,
        truckCount: truckCount.count,
        deviceCount: deviceCount.count,
        userCount: userCount.count
      };
    })
  );

  return orgsWithCounts;
}

async function getOrganizationDetails(orgName: string) {
  const org = await db
    .select()
    .from(organizations)
    .where(sql`LOWER(${organizations.name}) LIKE LOWER(${`%${orgName}%`})`)
    .limit(1);

  if (org.length === 0) {
    return { error: `Organization "${orgName}" not found` };
  }

  const orgId = org[0].id;

  const orgFleets = await db.select().from(fleets).where(eq(fleets.organizationId, orgId));
  const orgTrucks = await db.select().from(trucks).where(eq(trucks.organizationId, orgId));
  const orgDevices = await db.select().from(powerMonDevices).where(eq(powerMonDevices.organizationId, orgId));
  const orgUsers = await db.select({ id: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.organizationId, orgId));
  const orgAlerts = await db.select().from(alerts).where(and(eq(alerts.organizationId, orgId), not(eq(alerts.status, "resolved"))));

  return {
    organization: org[0],
    fleets: orgFleets,
    trucks: orgTrucks.map(t => ({ id: t.id, truckNumber: t.truckNumber, status: t.status })),
    devices: orgDevices.map(d => ({ id: d.id, serialNumber: d.serialNumber, deviceName: d.deviceName })),
    users: orgUsers,
    activeAlerts: orgAlerts.length
  };
}

async function getAllDevicesStatus(statusFilter: string = "all") {
  const allDevices = await db
    .select({
      deviceId: powerMonDevices.id,
      serialNumber: powerMonDevices.serialNumber,
      deviceName: powerMonDevices.deviceName,
      organizationId: powerMonDevices.organizationId,
      truckId: powerMonDevices.truckId
    })
    .from(powerMonDevices);

  const devicesWithStatus = await Promise.all(
    allDevices.map(async (device) => {
      const [snapshot] = await db
        .select()
        .from(deviceSnapshots)
        .where(eq(deviceSnapshots.deviceId, device.deviceId))
        .orderBy(desc(deviceSnapshots.updatedAt))
        .limit(1);

      const org = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, device.organizationId)).limit(1);
      
      const lastUpdate = snapshot?.updatedAt || snapshot?.recordedAt;
      const isOnline = lastUpdate ? (Date.now() - new Date(lastUpdate).getTime()) < 5 * 60 * 1000 : false;

      return {
        ...device,
        organizationName: org[0]?.name || "Unknown",
        soc: snapshot?.soc ?? null,
        voltage1: snapshot?.voltage1 ?? null,
        isOnline,
        lastUpdate: lastUpdate ? new Date(lastUpdate).toISOString() : null
      };
    })
  );

  if (statusFilter === "online") {
    return devicesWithStatus.filter(d => d.isOnline);
  } else if (statusFilter === "offline") {
    return devicesWithStatus.filter(d => !d.isOnline);
  }

  return devicesWithStatus;
}

async function getCrossOrgAlerts() {
  const activeAlerts = await db
    .select({
      id: alerts.id,
      alertType: alerts.alertType,
      severity: alerts.severity,
      title: alerts.title,
      message: alerts.message,
      status: alerts.status,
      organizationId: alerts.organizationId,
      truckId: alerts.truckId,
      deviceId: alerts.deviceId,
      createdAt: alerts.createdAt
    })
    .from(alerts)
    .where(not(eq(alerts.status, "resolved")))
    .orderBy(desc(alerts.createdAt));

  const alertsWithOrg = await Promise.all(
    activeAlerts.map(async (alert) => {
      const org = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, alert.organizationId)).limit(1);
      const truck = alert.truckId ? await db.select({ truckNumber: trucks.truckNumber }).from(trucks).where(eq(trucks.id, alert.truckId)).limit(1) : [];
      
      return {
        ...alert,
        organizationName: org[0]?.name || "Unknown",
        truckNumber: truck[0]?.truckNumber || null
      };
    })
  );

  return alertsWithOrg;
}

async function getUserStats() {
  const allUsers = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      organizationId: users.organizationId,
      createdAt: users.createdAt
    })
    .from(users);

  const usersByOrg = await Promise.all(
    allUsers.map(async (user) => {
      const org = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, user.organizationId)).limit(1);
      return {
        ...user,
        organizationName: org[0]?.name || "Unknown"
      };
    })
  );

  const orgCounts: Record<string, number> = {};
  usersByOrg.forEach(u => {
    orgCounts[u.organizationName] = (orgCounts[u.organizationName] || 0) + 1;
  });

  return {
    totalUsers: allUsers.length,
    usersByOrganization: orgCounts,
    users: usersByOrg.map(u => ({
      email: u.email,
      name: `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email,
      organization: u.organizationName
    }))
  };
}

async function getLowBatteryDevices(threshold: number = 60) {
  const snapshots = await db
    .select({
      deviceId: deviceSnapshots.deviceId,
      soc: deviceSnapshots.soc,
      voltage1: deviceSnapshots.voltage1,
      updatedAt: deviceSnapshots.updatedAt
    })
    .from(deviceSnapshots)
    .where(lt(deviceSnapshots.soc, threshold));

  const lowBatteryDevices = await Promise.all(
    snapshots.map(async (snap) => {
      const device = await db.select().from(powerMonDevices).where(eq(powerMonDevices.id, snap.deviceId)).limit(1);
      if (device.length === 0) return null;

      const org = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, device[0].organizationId)).limit(1);
      const truck = device[0].truckId ? await db.select({ truckNumber: trucks.truckNumber }).from(trucks).where(eq(trucks.id, device[0].truckId)).limit(1) : [];

      return {
        deviceName: device[0].deviceName,
        serialNumber: device[0].serialNumber,
        organizationName: org[0]?.name || "Unknown",
        truckNumber: truck[0]?.truckNumber || "Unassigned",
        soc: snap.soc,
        voltage: snap.voltage1
      };
    })
  );

  return lowBatteryDevices.filter(d => d !== null);
}

async function getFleetSummary() {
  const allFleets = await db
    .select({
      id: fleets.id,
      name: fleets.name,
      organizationId: fleets.organizationId
    })
    .from(fleets);

  const fleetSummaries = await Promise.all(
    allFleets.map(async (fleet) => {
      const org = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, fleet.organizationId)).limit(1);
      const [truckCount] = await db.select({ count: count() }).from(trucks).where(eq(trucks.fleetId, fleet.id));
      
      return {
        fleetName: fleet.name,
        organizationName: org[0]?.name || "Unknown",
        truckCount: truckCount.count
      };
    })
  );

  return fleetSummaries;
}

async function executeAdminTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    let result: unknown;
    
    switch (name) {
      case "get_system_overview":
        result = await getSystemOverview();
        break;
      case "list_organizations":
        result = await listOrganizations();
        break;
      case "get_organization_details":
        result = await getOrganizationDetails(args.organization_name as string);
        break;
      case "get_all_devices_status":
        result = await getAllDevicesStatus(args.status_filter as string);
        break;
      case "get_cross_org_alerts":
        result = await getCrossOrgAlerts();
        break;
      case "get_user_stats":
        result = await getUserStats();
        break;
      case "get_low_battery_devices":
        result = await getLowBatteryDevices(args.threshold as number);
        break;
      case "get_fleet_summary":
        result = await getFleetSummary();
        break;
      default:
        result = { error: `Unknown tool: ${name}` };
    }
    
    return JSON.stringify(result);
  } catch (error) {
    console.error(`[AdminAssistant] Tool execution error for ${name}:`, error);
    return JSON.stringify({ error: `Failed to execute ${name}` });
  }
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function processAdminChat(messages: ChatMessage[]): Promise<string> {
  const openai = getOpenAIClient();
  
  const formattedMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: ADMIN_SYSTEM_PROMPT },
    ...messages.map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content
    }))
  ];

  let response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: formattedMessages,
    tools: adminTools,
    tool_choice: "auto",
    max_tokens: 1024
  });

  let assistantMessage = response.choices[0].message;

  while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
    formattedMessages.push(assistantMessage);

    for (const toolCall of assistantMessage.tool_calls) {
      if (toolCall.type !== "function") continue;
      
      const args = JSON.parse(toolCall.function.arguments || "{}");
      console.log(`[AdminAssistant] Executing tool: ${toolCall.function.name}`, args);
      
      const result = await executeAdminTool(toolCall.function.name, args);
      
      formattedMessages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result
      });
    }

    response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: formattedMessages,
      tools: adminTools,
      tool_choice: "auto",
      max_tokens: 1024
    });

    assistantMessage = response.choices[0].message;
  }

  return assistantMessage.content || "I apologize, but I couldn't generate a response. Please try again.";
}
