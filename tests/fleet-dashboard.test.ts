import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import express from "express";
import {
  determineTruckStatus,
  calculateFuelSavings,
  PARKED_VOLTAGE_THRESHOLD,
  IDLE_BUFFER_MINUTES,
  GALLONS_PER_HOUR_IDLING,
} from "../shared/truck-status";

describe("Fleet Dashboard Integration Tests", () => {
  describe("Truck Status Detection Logic", () => {
    const fixedNow = new Date("2026-01-15T12:00:00Z");

    describe("Parked Status (Engine Off)", () => {
      it("should return Parked when chassis voltage is below threshold", () => {
        const result = determineTruckStatus({
          chassisVoltage: 12.5,
          hasShellyData: false,
          isMoving: false,
          lastMovementAt: null,
          now: fixedNow,
        });

        expect(result.statusLabel).toBe("Parked");
        expect(result.isParked).toBe(true);
        expect(result.isIdling).toBe(false);
        expect(result.isDriving).toBe(false);
      });

      it("should return Parked when voltage is exactly at threshold minus epsilon", () => {
        const result = determineTruckStatus({
          chassisVoltage: PARKED_VOLTAGE_THRESHOLD - 0.01,
          hasShellyData: true,
          isMoving: true,
          lastMovementAt: fixedNow,
          now: fixedNow,
        });

        expect(result.statusLabel).toBe("Parked");
        expect(result.isParked).toBe(true);
      });

      it("should return Parked when voltage is zero", () => {
        const result = determineTruckStatus({
          chassisVoltage: 0,
          hasShellyData: false,
          isMoving: false,
          lastMovementAt: null,
          now: fixedNow,
        });

        expect(result.statusLabel).toBe("Parked");
        expect(result.isParked).toBe(true);
      });
    });

    describe("Driving Status (Engine On + Movement)", () => {
      it("should return Driving when engine on and no Shelly sensor (legacy fallback)", () => {
        const result = determineTruckStatus({
          chassisVoltage: 14.2,
          hasShellyData: false,
          isMoving: false,
          lastMovementAt: null,
          now: fixedNow,
        });

        expect(result.statusLabel).toBe("Driving");
        expect(result.isDriving).toBe(true);
        expect(result.isIdling).toBe(false);
        expect(result.isParked).toBe(false);
      });

      it("should return Driving when Shelly shows currently moving", () => {
        const result = determineTruckStatus({
          chassisVoltage: 14.2,
          hasShellyData: true,
          isMoving: true,
          lastMovementAt: fixedNow,
          now: fixedNow,
        });

        expect(result.statusLabel).toBe("Driving");
        expect(result.isDriving).toBe(true);
        expect(result.isIdling).toBe(false);
      });

      it("should return Driving when movement was within 30-minute buffer", () => {
        const twentyMinutesAgo = new Date(fixedNow.getTime() - 20 * 60 * 1000);

        const result = determineTruckStatus({
          chassisVoltage: 14.0,
          hasShellyData: true,
          isMoving: false,
          lastMovementAt: twentyMinutesAgo,
          now: fixedNow,
        });

        expect(result.statusLabel).toBe("Driving");
        expect(result.isDriving).toBe(true);
        expect(result.isIdling).toBe(false);
      });

      it("should return Driving when movement was 29 minutes ago (just inside buffer)", () => {
        const justInsideBuffer = new Date(fixedNow.getTime() - 29 * 60 * 1000);

        const result = determineTruckStatus({
          chassisVoltage: 14.0,
          hasShellyData: true,
          isMoving: false,
          lastMovementAt: justInsideBuffer,
          now: fixedNow,
        });

        expect(result.statusLabel).toBe("Driving");
        expect(result.isDriving).toBe(true);
      });
    });

    describe("Idling Status (Engine On + No Movement + Buffer Expired)", () => {
      it("should return Idling when Shelly exists but never detected movement", () => {
        const result = determineTruckStatus({
          chassisVoltage: 14.2,
          hasShellyData: true,
          isMoving: false,
          lastMovementAt: null,
          now: fixedNow,
        });

        expect(result.statusLabel).toBe("Idling");
        expect(result.isIdling).toBe(true);
        expect(result.isDriving).toBe(false);
        expect(result.isParked).toBe(false);
      });

      it("should return Idling when no movement for exactly 30 minutes", () => {
        const exactlyThirtyMinutesAgo = new Date(fixedNow.getTime() - 30 * 60 * 1000);

        const result = determineTruckStatus({
          chassisVoltage: 14.0,
          hasShellyData: true,
          isMoving: false,
          lastMovementAt: exactlyThirtyMinutesAgo,
          now: fixedNow,
        });

        expect(result.statusLabel).toBe("Idling");
        expect(result.isIdling).toBe(true);
      });

      it("should return Idling when no movement for over 30 minutes", () => {
        const fortyFiveMinutesAgo = new Date(fixedNow.getTime() - 45 * 60 * 1000);

        const result = determineTruckStatus({
          chassisVoltage: 14.0,
          hasShellyData: true,
          isMoving: false,
          lastMovementAt: fortyFiveMinutesAgo,
          now: fixedNow,
        });

        expect(result.statusLabel).toBe("Idling");
        expect(result.isIdling).toBe(true);
        expect(result.isDriving).toBe(false);
      });

      it("should return Idling when truck is warming up (engine on, Shelly but no movement)", () => {
        const result = determineTruckStatus({
          chassisVoltage: 13.5,
          hasShellyData: true,
          isMoving: false,
          lastMovementAt: null,
          now: fixedNow,
        });

        expect(result.statusLabel).toBe("Idling");
        expect(result.isIdling).toBe(true);
      });
    });

    describe("Voltage Threshold Boundary Tests", () => {
      it("should return engine-on status when voltage is exactly at threshold", () => {
        const result = determineTruckStatus({
          chassisVoltage: PARKED_VOLTAGE_THRESHOLD,
          hasShellyData: false,
          isMoving: false,
          lastMovementAt: null,
          now: fixedNow,
        });

        expect(result.isParked).toBe(false);
        expect(result.statusLabel).toBe("Driving");
      });

      it("should handle high voltage scenarios", () => {
        const result = determineTruckStatus({
          chassisVoltage: 14.8,
          hasShellyData: true,
          isMoving: true,
          lastMovementAt: fixedNow,
          now: fixedNow,
        });

        expect(result.statusLabel).toBe("Driving");
      });
    });

    describe("State Transitions", () => {
      it("should transition: Parked -> Idling (engine starts, no movement)", () => {
        const parked = determineTruckStatus({
          chassisVoltage: 12.5,
          hasShellyData: true,
          isMoving: false,
          lastMovementAt: null,
          now: fixedNow,
        });
        expect(parked.statusLabel).toBe("Parked");

        const idling = determineTruckStatus({
          chassisVoltage: 14.0,
          hasShellyData: true,
          isMoving: false,
          lastMovementAt: null,
          now: fixedNow,
        });
        expect(idling.statusLabel).toBe("Idling");
      });

      it("should transition: Idling -> Driving (movement detected)", () => {
        const idling = determineTruckStatus({
          chassisVoltage: 14.0,
          hasShellyData: true,
          isMoving: false,
          lastMovementAt: null,
          now: fixedNow,
        });
        expect(idling.statusLabel).toBe("Idling");

        const driving = determineTruckStatus({
          chassisVoltage: 14.0,
          hasShellyData: true,
          isMoving: true,
          lastMovementAt: fixedNow,
          now: fixedNow,
        });
        expect(driving.statusLabel).toBe("Driving");
      });

      it("should transition: Driving -> Idling (30 min without movement)", () => {
        const driving = determineTruckStatus({
          chassisVoltage: 14.0,
          hasShellyData: true,
          isMoving: true,
          lastMovementAt: fixedNow,
          now: fixedNow,
        });
        expect(driving.statusLabel).toBe("Driving");

        const thirtyOneMinutesLater = new Date(fixedNow.getTime() + 31 * 60 * 1000);
        const idling = determineTruckStatus({
          chassisVoltage: 14.0,
          hasShellyData: true,
          isMoving: false,
          lastMovementAt: fixedNow,
          now: thirtyOneMinutesLater,
        });
        expect(idling.statusLabel).toBe("Idling");
      });

      it("should transition: Driving -> Parked (engine off)", () => {
        const driving = determineTruckStatus({
          chassisVoltage: 14.0,
          hasShellyData: true,
          isMoving: true,
          lastMovementAt: fixedNow,
          now: fixedNow,
        });
        expect(driving.statusLabel).toBe("Driving");

        const parked = determineTruckStatus({
          chassisVoltage: 12.8,
          hasShellyData: true,
          isMoving: false,
          lastMovementAt: fixedNow,
          now: fixedNow,
        });
        expect(parked.statusLabel).toBe("Parked");
      });
    });
  });

  describe("Fuel Savings Calculations", () => {
    it("should calculate fuel savings for 60 minutes parked", () => {
      const savings = calculateFuelSavings(60, 3.50);
      const expectedGallons = 1 * GALLONS_PER_HOUR_IDLING;
      expect(savings).toBeCloseTo(expectedGallons * 3.50, 2);
    });

    it("should calculate fuel savings for 120 minutes parked", () => {
      const savings = calculateFuelSavings(120, 4.00);
      const expectedGallons = 2 * GALLONS_PER_HOUR_IDLING;
      expect(savings).toBeCloseTo(expectedGallons * 4.00, 2);
    });

    it("should return 0 for 0 minutes parked", () => {
      const savings = calculateFuelSavings(0, 3.50);
      expect(savings).toBe(0);
    });

    it("should handle partial hours correctly", () => {
      const savings = calculateFuelSavings(30, 3.50);
      const expectedGallons = 0.5 * GALLONS_PER_HOUR_IDLING;
      expect(savings).toBeCloseTo(expectedGallons * 3.50, 2);
    });

    it("should use default diesel price when not provided", () => {
      const savings = calculateFuelSavings(60);
      const expectedGallons = 1 * GALLONS_PER_HOUR_IDLING;
      expect(savings).toBeCloseTo(expectedGallons * 3.50, 2);
    });
  });

  describe("Constants Validation", () => {
    it("should have correct parked voltage threshold", () => {
      expect(PARKED_VOLTAGE_THRESHOLD).toBe(13.2);
    });

    it("should have correct idle buffer minutes", () => {
      expect(IDLE_BUFFER_MINUTES).toBe(30);
    });

    it("should have correct gallons per hour idling", () => {
      expect(GALLONS_PER_HOUR_IDLING).toBe(1.2);
    });
  });
});
