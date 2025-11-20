import { Truck, HistoricalDataPoint, TruckWithHistory } from "@shared/schema";

//todo: remove mock functionality
const truckNames = [
  "Alpha-1", "Beta-2", "Gamma-3", "Delta-4", "Epsilon-5",
  "Zeta-6", "Eta-7", "Theta-8", "Iota-9", "Kappa-10"
];

const models = ["DEC-T500", "DEC-T600", "DEC-T700"];
const locations = [
  { city: "San Francisco, CA", lat: 37.7749, lon: -122.4194 },
  { city: "Los Angeles, CA", lat: 34.0522, lon: -118.2437 },
  { city: "Phoenix, AZ", lat: 33.4484, lon: -112.0740 },
  { city: "Denver, CO", lat: 39.7392, lon: -104.9903 },
  { city: "Dallas, TX", lat: 32.7767, lon: -96.7970 },
  { city: "Chicago, IL", lat: 41.8781, lon: -87.6298 },
  { city: "New York, NY", lat: 40.7128, lon: -74.0060 },
  { city: "Miami, FL", lat: 25.7617, lon: -80.1918 },
  { city: "Seattle, WA", lat: 47.6062, lon: -122.3321 },
  { city: "Atlanta, GA", lat: 33.7490, lon: -84.3880 },
];

function generateHistoricalData(): HistoricalDataPoint[] {
  const data: HistoricalDataPoint[] = [];
  const now = Date.now();
  const hoursBack = 24;
  
  for (let i = hoursBack; i >= 0; i--) {
    const timestamp = now - (i * 60 * 60 * 1000);
    const soc = 65 + Math.random() * 30 + Math.sin(i / 4) * 10;
    const voltage = 48 + Math.random() * 4;
    const current = 20 + Math.random() * 30;
    const watts = voltage * current;
    
    data.push({
      timestamp,
      soc: Math.max(0, Math.min(100, soc)),
      voltage,
      current,
      watts,
    });
  }
  
  return data;
}

export function generateMockTrucks(): TruckWithHistory[] {
  return truckNames.map((name, index) => {
    const location = locations[index];
    const isInService = Math.random() > 0.2;
    const soc = isInService ? 60 + Math.random() * 35 : 20 + Math.random() * 40;
    
    const truck: TruckWithHistory = {
      id: `truck-${index + 1}`,
      name,
      model: models[index % models.length],
      serial: `SN${1000 + index}${String.fromCharCode(65 + (index % 26))}`,
      fw: `v${2 + Math.floor(index / 3)}.${index % 10}.${Math.floor(Math.random() * 10)}`,
      v1: 48 + Math.random() * 4,
      v2: 48 + Math.random() * 4,
      p: 15 + Math.random() * 25,
      wh: 5000 + Math.random() * 3000,
      ah: 100 + Math.random() * 50,
      temp: 35 + Math.random() * 15,
      soc,
      runtime: 100 + Math.random() * 500,
      ps: isInService ? "Active" : "Standby",
      address: location.city,
      x: `${Math.floor(Math.random() * 1000)}`,
      rssi: -40 - Math.floor(Math.random() * 50),
      status: isInService ? "in-service" : "not-in-service",
      latitude: location.lat,
      longitude: location.lon,
      history: generateHistoricalData(),
    };
    
    return truck;
  });
}
