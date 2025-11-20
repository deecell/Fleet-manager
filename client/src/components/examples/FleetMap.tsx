import { useState } from 'react';
import FleetMap from '../FleetMap';
import { Truck } from '@shared/schema';

const mockTrucks: Truck[] = [
  {
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
  },
  {
    id: "2",
    name: "Beta-2",
    model: "DEC-T600",
    serial: "SN1001B",
    fw: "v2.2.1",
    v1: 48.5,
    v2: 48.9,
    p: 18.2,
    wh: 5800,
    ah: 110,
    temp: 38,
    soc: 72,
    runtime: 280,
    ps: "Active",
    address: "Los Angeles, CA",
    x: "456",
    rssi: -62,
    status: "in-service",
    latitude: 34.0522,
    longitude: -118.2437,
  },
  {
    id: "3",
    name: "Gamma-3",
    model: "DEC-T500",
    serial: "SN1002C",
    fw: "v2.1.5",
    v1: 51.1,
    v2: 50.3,
    p: 8.5,
    wh: 4200,
    ah: 85,
    temp: 35,
    soc: 45,
    runtime: 150,
    ps: "Standby",
    address: "Phoenix, AZ",
    x: "789",
    rssi: -70,
    status: "not-in-service",
    latitude: 33.4484,
    longitude: -112.0740,
  },
];

export default function FleetMapExample() {
  const [selectedTruckId, setSelectedTruckId] = useState<string>();
  
  return (
    <FleetMap 
      trucks={mockTrucks}
      selectedTruckId={selectedTruckId}
      onTruckSelect={(id) => {
        console.log('Truck selected:', id);
        setSelectedTruckId(id);
      }}
    />
  );
}
