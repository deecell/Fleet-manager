/**
 * SIMPro API Client
 * 
 * Integrates with Wireless Logic's SIMPro platform for:
 * - SIM card management and status
 * - Location tracking via cell tower triangulation
 * - Data usage monitoring
 * 
 * API Documentation: https://simpro4.wirelesslogic.com/doc/restapi/v3
 */

const SIMPRO_BASE_URL = 'https://simpro4.wirelesslogic.com/api/v3';

export interface SimProConfig {
  apiClient: string;
  apiKey: string;
}

export interface SimProSim {
  id: number;
  iccid: string;
  eid?: string;
  msisdn: string;
  imsi?: string;
  status: string;
  workflow_status?: string;
}

export interface SimProSimsResponse {
  sims: SimProSim[];
  sim_count: number;
}

export interface SimProSimDetails {
  id: number;
  iccid: string;
  eid?: string;
  msisdn: string;
  imsi?: string;
  status: string;
  workflow_status?: string;
  account_number?: string;
  tariff_name?: string;
  ip_address?: string;
  custom_field1?: string;
  custom_field2?: string;
  custom_field3?: string;
  custom_field4?: string;
  custom_field5?: string;
  custom_field6?: string;
  custom_field7?: string;
  custom_field8?: string;
  custom_field9?: string;
  custom_field10?: string;
  activation_date?: string;
  last_usage_date?: string;
}

export interface SimProLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp?: string;
  mcc?: string;
  mnc?: string;
  lac?: string;
  cell_id?: string;
}

export interface SimProUsage {
  data_used_mb?: number;
  data_limit_mb?: number;
  sms_used?: number;
  sms_limit?: number;
  voice_used_minutes?: number;
  voice_limit_minutes?: number;
  billing_period_start?: string;
  billing_period_end?: string;
}

export interface SimProUsageHistory {
  period: string;
  data_used_mb: number;
  sms_count: number;
  voice_minutes?: number;
}

export class SimProApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public response?: unknown
  ) {
    super(message);
    this.name = 'SimProApiError';
  }
}

export class SimProClient {
  private apiClient: string;
  private apiKey: string;

  constructor(config: SimProConfig) {
    if (!config.apiClient || !config.apiKey) {
      throw new Error('SIMPro API credentials required: apiClient and apiKey');
    }
    this.apiClient = config.apiClient;
    this.apiKey = config.apiKey;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${SIMPRO_BASE_URL}${endpoint}`;
    
    const headers: Record<string, string> = {
      'x-api-client': this.apiClient,
      'x-api-key': this.apiKey,
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (!response.ok) {
        let errorBody: unknown;
        try {
          errorBody = await response.json();
        } catch {
          errorBody = await response.text();
        }
        throw new SimProApiError(
          `SIMPro API error: ${response.status} ${response.statusText}`,
          response.status,
          errorBody
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof SimProApiError) {
        throw error;
      }
      throw new SimProApiError(
        `SIMPro API request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        0
      );
    }
  }

  /**
   * Get all SIMs with optional filtering
   */
  async getSims(params?: {
    status?: string;
    page?: number;
    limit?: number;
    account_number?: string;
    custom_field1?: string;
    custom_field2?: string;
    custom_field3?: string;
  }): Promise<SimProSimsResponse> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          searchParams.append(key, String(value));
        }
      });
    }
    const query = searchParams.toString();
    return this.request<SimProSimsResponse>(`/sims${query ? `?${query}` : ''}`);
  }

  /**
   * Get detailed information about a specific SIM
   */
  async getSimDetails(msisdn: string): Promise<SimProSimDetails> {
    return this.request<SimProSimDetails>(`/sim/${msisdn}/details`);
  }

  /**
   * Get the location of a SIM (cell tower triangulation)
   */
  async getSimLocation(msisdn: string): Promise<SimProLocation> {
    return this.request<SimProLocation>(`/sim/${msisdn}/location`);
  }

  /**
   * Get cell tower location for a SIM
   */
  async getCellTowerLocation(msisdn: string): Promise<SimProLocation> {
    return this.request<SimProLocation>(`/cell-tower-location/${msisdn}`);
  }

  /**
   * Get current usage for a SIM
   */
  async getSimUsage(msisdn: string): Promise<SimProUsage> {
    return this.request<SimProUsage>(`/sim/${msisdn}/usage`);
  }

  /**
   * Get usage history for previous months
   */
  async getUsageHistory(msisdn: string): Promise<SimProUsageHistory[]> {
    return this.request<SimProUsageHistory[]>(`/sim/${msisdn}/usage-history`);
  }

  /**
   * Test connection to SIMPro API
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.getSims({ limit: 1 });
      return true;
    } catch (error) {
      console.error('SIMPro connection test failed:', error);
      return false;
    }
  }

  /**
   * Get all SIMs matching a device name in custom fields
   * This is used to link SIMs to PowerMon devices
   */
  async getSimsByDeviceName(deviceName: string): Promise<SimProSim[]> {
    const result = await this.getSims({ custom_field1: deviceName });
    return result.sims;
  }
}

/**
 * Create a SIMPro client from environment variables
 */
export function createSimProClient(): SimProClient | null {
  const apiClient = process.env.SIMPRO_API_CLIENT;
  const apiKey = process.env.SIMPRO_API_KEY;

  if (!apiClient || !apiKey) {
    console.warn('SIMPro API credentials not configured. Set SIMPRO_API_CLIENT and SIMPRO_API_KEY environment variables.');
    return null;
  }

  return new SimProClient({ apiClient, apiKey });
}
