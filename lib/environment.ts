/** Original design-preview implementation of published astronomy equations.
 * Sun: https://gml.noaa.gov/grad/solcalc/solareqns.PDF
 * Ecliptic solar longitude: https://aa.usno.navy.mil/faq/sun_approx
 * Mean lunar cycle/epoch: https://eclipse.gsfc.nasa.gov/phase/phases1901.html
 * Moon is an approximate mean-cycle ecliptic orbit, not a lunar ephemeris:
 * perturbations, inclination, refraction and topocentric parallax are omitted.
 * Light intensities/colors are artistic preview settings, not measured lux.
 */
export interface EnvironmentSettings {
  enabled: boolean;
  weather: 'clear' | 'cloudy' | 'rain';
  landscape: 'garden' | 'city' | 'none';
  date: string;
  latitude: number;
  longitude: number;
  utcOffset: number;
  indoorLights: 'auto' | 'on' | 'off';
  indoorIntensity: number;
}
export type ProjectEnvironment = EnvironmentSettings & {hour: number; north: number};
export interface EnvironmentState {
  sunDirection: [number, number, number]; moonDirection: [number, number, number];
  sunAltitude: number; moonAltitude: number; sunAzimuth: number; moonAzimuth: number;
  sunriseHour: number | null; sunsetHour: number | null; solarNoonHour: number;
  daylight: number; twilight: number; night: number;
  sunIntensity: number; sunColor: string;
  skyTopColor: string; skyHorizonColor: string; groundColor: string;
  ambientIntensity: number; hemisphereIntensity: number; environmentIntensity: number;
  moonPhase: number; moonIllumination: number; moonIntensity: number;
  clouds: number; indoorLightLevel: number;
}
export const DEFAULT_ENVIRONMENT: EnvironmentSettings = {
  enabled: true, weather: 'clear', landscape: 'garden', date: '2026-11-18',
  latitude: 31.23, longitude: 121.47, utcOffset: 8,
  indoorLights: 'auto', indoorIntensity: .8,
};
export const ENVIRONMENT_LOCATIONS = [
  {name: '上海', latitude: 31.23, longitude: 121.47, utcOffset: 8},
  {name: '北京', latitude: 39.9, longitude: 116.4, utcOffset: 8},
  {name: '广州', latitude: 23.13, longitude: 113.26, utcOffset: 8},
  {name: '成都', latitude: 30.57, longitude: 104.07, utcOffset: 8},
] as const;
const RAD = Math.PI / 180, DAY = 86400000;
const clamp = (x: number, min = 0, max = 1) => Math.max(min, Math.min(max, x));
const modulo = (x: number, cycle: number) => ((x % cycle) + cycle) % cycle;
const finite = (input: unknown, fallback: number, min: number, max: number) => typeof input === 'number' && Number.isFinite(input) ? clamp(input, min, max) : fallback;
const smooth = (a: number, b: number, value: number) => {const x = clamp((value-a)/(b-a)); return x*x*(3-2*x);};
export function isEnvironmentDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  return year >= 1900 && year <= 2100 && new Date(Date.UTC(year, month-1, day)).toISOString().slice(0,10) === value;
}
export function localEnvironmentDate(date = new Date()): string {
  const value = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  return isEnvironmentDate(value) ? value : DEFAULT_ENVIRONMENT.date;
}
export function sanitizeEnvironmentSettings(input: unknown): EnvironmentSettings {
  const data = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string,unknown> : {};
  return {
    enabled: typeof data.enabled === 'boolean' ? data.enabled : true,
    weather: data.weather === 'cloudy' || data.weather === 'rain' ? data.weather : 'clear',
    landscape: data.landscape === 'city' || data.landscape === 'none' ? data.landscape : 'garden',
    date: isEnvironmentDate(data.date) ? data.date : DEFAULT_ENVIRONMENT.date,
    latitude: finite(data.latitude, DEFAULT_ENVIRONMENT.latitude, -90, 90),
    longitude: finite(data.longitude, DEFAULT_ENVIRONMENT.longitude, -180, 180),
    utcOffset: finite(data.utcOffset, 8, -12, 14),
    indoorLights: data.indoorLights === 'on' || data.indoorLights === 'off' ? data.indoorLights : 'auto',
    indoorIntensity: finite(data.indoorIntensity, .8, 0, 1),
  };
}
function mix(a: string, b: string, amount: number): string {
  const color = (hex: string) => [1,3,5].map(i => parseInt(hex.slice(i,i+2),16));
  const start = color(a), end = color(b), t = clamp(amount);
  return '#'+start.map((value,i)=>Math.round(value+(end[i]-value)*t).toString(16).padStart(2,'0')).join('');
}
/** Equatorial direction to local east/up/south, then rotate the plan's true north. */
function horizontal(declination: number, hourAngle: number, latitude: number, north: number) {
  const lat = latitude*RAD;
  const east = -Math.cos(declination)*Math.sin(hourAngle);
  const up = Math.sin(lat)*Math.sin(declination)+Math.cos(lat)*Math.cos(declination)*Math.cos(hourAngle);
  const northward = Math.cos(lat)*Math.sin(declination)-Math.sin(lat)*Math.cos(declination)*Math.cos(hourAngle);
  const angle = north*RAD;
  const direction: [number,number,number] = [east*Math.cos(angle)+northward*Math.sin(angle), up, east*Math.sin(angle)-northward*Math.cos(angle)];
  const length = Math.hypot(...direction);
  return {direction: direction.map(value => value/length) as [number,number,number], altitude: Math.asin(clamp(up,-1,1))/RAD, azimuth: modulo(Math.atan2(east,northward)/RAD,360)};
}
export function deriveEnvironment(input: EnvironmentSettings, inputHour = 12, inputNorth = 0): EnvironmentState {
  const settings = sanitizeEnvironmentSettings(input);
  const hour = finite(inputHour,12,0,24), north = finite(inputNorth,0,-180,180);
  const [year,month,day] = settings.date.split('-').map(Number);
  const midnight = Date.UTC(year,month-1,day);
  const timestamp = midnight+(hour-settings.utcOffset)*3600000;
  const instant = new Date(timestamp), utcYear = instant.getUTCFullYear();
  const utcMidnight = Date.UTC(utcYear,instant.getUTCMonth(),instant.getUTCDate());
  const dayOfYear = Math.round((utcMidnight-Date.UTC(utcYear,0,1))/DAY)+1;
  const daysInYear = Math.round((Date.UTC(utcYear+1,0,1)-Date.UTC(utcYear,0,1))/DAY);
  const utcHour = (timestamp-utcMidnight)/3600000;
  const gamma = 2*Math.PI/daysInYear*(dayOfYear-1+(utcHour-12)/24);
  const equation = 229.18*(.000075+.001868*Math.cos(gamma)-.032077*Math.sin(gamma)-.014615*Math.cos(2*gamma)-.040849*Math.sin(2*gamma));
  const declination = .006918-.399912*Math.cos(gamma)+.070257*Math.sin(gamma)-.006758*Math.cos(2*gamma)+.000907*Math.sin(2*gamma)-.002697*Math.cos(3*gamma)+.00148*Math.sin(3*gamma);
  const trueMinutes = hour*60+equation+4*settings.longitude-60*settings.utcOffset;
  const sun = horizontal(declination,(trueMinutes/4-180)*RAD,settings.latitude,north);
  const solarNoonHour = modulo((720-4*settings.longitude-equation+60*settings.utcOffset)/60,24);
  const cosRise = (Math.cos(90.833*RAD)-Math.sin(settings.latitude*RAD)*Math.sin(declination))/(Math.cos(settings.latitude*RAD)*Math.cos(declination));
  const riseSpan = Number.isFinite(cosRise) && Math.abs(cosRise) <= 1 ? Math.acos(cosRise)/RAD/15 : null;

  const julian = timestamp/DAY+2440587.5, daysJ2000 = julian-2451545;
  const newMoonEpoch = Date.UTC(2000,0,6,18,14), synodicDays = 29.530588;
  const moonPhase = modulo((timestamp-newMoonEpoch)/DAY/synodicDays,1);
  const moonIllumination = (1-Math.cos(moonPhase*2*Math.PI))/2;
  const anomaly = (357.529+.98560028*daysJ2000)*RAD;
  const sunLongitude = (280.459+.98564736*daysJ2000+1.915*Math.sin(anomaly)+.020*Math.sin(2*anomaly))*RAD;
  const lunarLongitude = sunLongitude+moonPhase*2*Math.PI;
  const obliquity = (23.439-.00000036*daysJ2000)*RAD;
  const lunarRA = Math.atan2(Math.cos(obliquity)*Math.sin(lunarLongitude),Math.cos(lunarLongitude));
  const lunarDec = Math.asin(Math.sin(obliquity)*Math.sin(lunarLongitude));
  const sidereal = modulo(280.46061837+360.98564736629*daysJ2000+settings.longitude,360)*RAD;
  const moon = horizontal(lunarDec,sidereal-lunarRA,settings.latitude,north);

  const altitude = sun.altitude, daylight = smooth(-6,18,altitude);
  const night = 1-smooth(-12,-2,altitude), twilight = smooth(-12,-1,altitude)*(1-smooth(2,14,altitude));
  const clouds = {clear:.18,cloudy:.78,rain:.96}[settings.weather];
  const transmission = {clear:1,cloudy:.4,rain:.18}[settings.weather];
  const skyBlend = smooth(-12,14,altitude);
  const topDay = {clear:'#82bce4',cloudy:'#8e9fae',rain:'#6d7b8e'}[settings.weather];
  const horizonDay = {clear:'#ddebf0',cloudy:'#dce1e0',rain:'#a9b4bf'}[settings.weather];
  const skyTopColor = mix('#071021',topDay,skyBlend);
  const skyHorizonColor = mix(mix('#1b263d',horizonDay,skyBlend),'#efa774',twilight*(1-clouds*.75));
  const indoorLightLevel = settings.indoorLights === 'off' ? 0 : settings.indoorIntensity*(settings.indoorLights === 'on' ? 1 : 1-smooth(-3,8,altitude));
  return {
    sunDirection:sun.direction,moonDirection:moon.direction,sunAltitude:altitude,moonAltitude:moon.altitude,sunAzimuth:sun.azimuth,moonAzimuth:moon.azimuth,
    sunriseHour:riseSpan===null?null:modulo(solarNoonHour-riseSpan,24),sunsetHour:riseSpan===null?null:modulo(solarNoonHour+riseSpan,24),solarNoonHour,
    daylight,night,twilight,clouds,indoorLightLevel,
    sunIntensity:smooth(-.833,3,altitude)*(.8+2*Math.max(0,Math.sin(altitude*RAD)))*transmission,
    sunColor:mix('#ffc08b','#fff1d7',smooth(0,25,altitude)),
    skyTopColor,skyHorizonColor,groundColor:mix('#172522',settings.landscape==='city'?'#aaa79e':'#7d8b63',daylight),
    ambientIntensity:.025+daylight*.09+twilight*.018,
    hemisphereIntensity:.06+daylight*.5,
    environmentIntensity:.035+daylight*(settings.weather==='clear'?.48:settings.weather==='cloudy'?.4:.28),
    moonPhase,moonIllumination,moonIntensity:.2*moonIllumination*Math.max(0,Math.sin(moon.altitude*RAD))*night*(1-clouds*.8),
  };
}
