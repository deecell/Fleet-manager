import TruckDetail from '../TruckDetail';
import { TruckWithHistory } from '@shared/schema';

const mockTruck: TruckWithHistory = {
  id: "1",
  name: "Alpha-1",
  model: "DEC-T500",
  serial: "SN1000A",
  fw: "v2.1.0",
  v1: 50.2,
  v2: 49.8,
  p: 25.5,
  wh: 6500,
  ah: 125,
  temp: 42,
  soc: 85,
  runtime: 320,
  ps: "Active",
  address: "San Francisco, CA",
  x: "123",
  rssi: -55,
  status: "in-service",
  latitude: 37.7749,
  longitude: -122.4194,
  history: [
    { timestamp: Date.now() - 24 * 60 * 60 * 1000, soc: 70, voltage: 48.5, current: 22, watts: 1067 },
    { timestamp: Date.now() - 20 * 60 * 60 * 1000, soc: 75, voltage: 49.2, current: 25, watts: 1230 },
    { timestamp: Date.now() - 16 * 60 * 60 * 1000, soc: 78, voltage: 49.8, current: 28, watts: 1394 },
    { timestamp: Date.now() - 12 * 60 * 60 * 1000, soc: 80, voltage: 50.1, current: 30, watts: 1503 },
    { timestamp: Date.now() - 8 * 60 * 60 * 1000, soc: 82, voltage: 50.3, current: 27, watts: 1358 },
    { timestamp: Date.now() - 4 * 60 * 60 * 1000, soc: 84, voltage: 50.5, current: 24, watts: 1212 },
    { timestamp: Date.now(), soc: 85, voltage: 50.2, current: 25, watts: 1255 },
  ],
};

export default function TruckDetailExample() {
  return (
    <div className="relative h-screen">
      <TruckDetail 
        truck={mockTruck}
        onClose={() => console.log('Close clicked')}
      />
    </div>
  );
}
