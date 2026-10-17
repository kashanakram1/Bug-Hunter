export const eventPlan = {
  name: 'Bug Hunter Module-5',
  timezone: 'Asia/Karachi',
  onlineStart: '2026-10-18T16:00:00+05:00',
  entryClose: '2026-10-18T16:30:00+05:00',
  onsiteDate: '2026-10-22',
} as const;

export function eventTime(value: string, timezone: string = eventPlan.timezone) {
  return new Intl.DateTimeFormat('en-PK', {
    timeZone: timezone, day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(value));
}
