export const PARKED_VOLTAGE_THRESHOLD = 13.2;
export const IDLE_BUFFER_MINUTES = 30;
export const GALLONS_PER_HOUR_IDLING = 1.2;
export const DEFAULT_DIESEL_PRICE = 3.50;

export type TruckStatusLabel = "Driving" | "Parked" | "Idling";

export interface StatusInput {
  chassisVoltage: number;
  hasShellyData: boolean;
  isMoving: boolean;
  lastMovementAt: Date | null;
  now?: Date;
}

export interface StatusResult {
  statusLabel: TruckStatusLabel;
  isParked: boolean;
  isIdling: boolean;
  isDriving: boolean;
}

export function determineTruckStatus(input: StatusInput): StatusResult {
  const now = input.now?.getTime() ?? Date.now();
  
  const isParked = input.chassisVoltage < PARKED_VOLTAGE_THRESHOLD;
  
  if (isParked) {
    return {
      statusLabel: "Parked",
      isParked: true,
      isIdling: false,
      isDriving: false,
    };
  }
  
  let isDriving = false;
  
  if (!input.hasShellyData) {
    isDriving = true;
  } else if (input.isMoving) {
    isDriving = true;
  } else if (input.lastMovementAt) {
    const lastMovementTime = input.lastMovementAt.getTime();
    const minutesSinceMovement = (now - lastMovementTime) / 60000;
    isDriving = minutesSinceMovement < IDLE_BUFFER_MINUTES;
  }
  
  const isIdling = input.hasShellyData && !isDriving;
  
  return {
    statusLabel: isDriving ? "Driving" : "Idling",
    isParked: false,
    isIdling,
    isDriving,
  };
}

export function calculateFuelSavings(
  parkedMinutes: number,
  dieselPrice: number = DEFAULT_DIESEL_PRICE
): number {
  const parkedHours = parkedMinutes / 60;
  const gallonsSaved = parkedHours * GALLONS_PER_HOUR_IDLING;
  return gallonsSaved * dieselPrice;
}
