import 'server-only';

// The InkyPi data bundle behind the Frame image — GET /api/current_data on
// the device (its feat/current-data-bundle PR): { plugin_id, generated_at,
// data } where data is the rendered plugin's template params. For the
// weather_agenda plugin that means current conditions, day forecast, 24h
// hourlies, data points, and sun events. Fetched SERVER-side (the Next
// process reaches the tailnet host) with a 5-minute revalidate, so the
// browser never talks to the device and CORS/mixed-content never applies.
//
// Every field is optional — the bundle is another system's internals, so
// the Weather panel must render whatever subset is present and never throw.

export interface WeatherDataPoint {
  label: string;
  measurement: string | number;
  unit: string;
  arrow?: string;
}

export interface WeatherForecastDay {
  day: string;
  date: string;
  high: number;
  low: number;
  high_alt?: string | number;
  low_alt?: string | number;
  alt_unit?: string;
  rain_pct?: number;
  uvi?: number;
  wind_speed?: number | string;
  wind_unit?: string;
}

export interface WeatherHour {
  time: string;
  temperature: number;
  precipitation?: number; // probability 0..1
  rain?: number; // amount
}

export interface WeatherData {
  title?: string;
  updated_at_text?: string;
  current_date?: string;
  current_temperature?: string;
  current_temperature_alt?: string | number;
  temperature_unit?: string;
  temperature_unit_alt?: string;
  units?: string;
  forecast?: WeatherForecastDay[];
  hourly_forecast?: WeatherHour[];
  data_points?: WeatherDataPoint[];
}

export interface FrameDataBundle {
  plugin_id?: string;
  generated_at?: string;
  data?: WeatherData;
}

export async function getFrameData(url: string): Promise<FrameDataBundle | null> {
  try {
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return (await res.json()) as FrameDataBundle;
  } catch {
    // Device unreachable (off, off-net) — the panel degrades quietly.
    return null;
  }
}
