// WMO weather codes (Open-Meteo) → short label and a static icon name (frame/public/icons/<icon>.svg).

const TABLE = [
  [[0], 'Clear', 'clear'],
  [[1], 'Mostly clear', 'partly'],
  [[2], 'Partly cloudy', 'partly'],
  [[3], 'Cloudy', 'cloud'],
  [[45, 48], 'Fog', 'fog'],
  [[51, 53, 55, 56, 57], 'Drizzle', 'drizzle'],
  [[61, 63, 66, 80, 81], 'Rain', 'rain'],
  [[65, 67, 82], 'Heavy rain', 'rain'],
  [[71, 73, 77, 85], 'Snow', 'snow'],
  [[75, 86], 'Heavy snow', 'snow'],
  [[95], 'Thunderstorms', 'storm'],
  [[96, 99], 'Storms, hail', 'storm'],
];

const MAP = new Map();
for (const [codes, label, icon] of TABLE) for (const c of codes) MAP.set(c, { label, icon });

/** {label, icon} for a WMO code. Clear and partly-cloudy skies get a night icon when isDay is false. */
export function describeWeather(code, isDay = true) {
  const hit = MAP.get(Number(code)) || { label: 'Unknown', icon: 'cloud' };
  if (!isDay && hit.icon === 'clear') return { label: hit.label, icon: 'clear-night' };
  if (!isDay && hit.icon === 'partly') return { label: hit.label, icon: 'partly-night' };
  return { label: hit.label, icon: hit.icon };
}

export const ICONS = ['clear', 'clear-night', 'partly', 'partly-night', 'cloud', 'fog', 'drizzle', 'rain', 'snow', 'storm'];
