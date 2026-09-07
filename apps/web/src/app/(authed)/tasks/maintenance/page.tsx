import { redirect } from 'next/navigation';

// The recurring-upkeep audit view moved: /tasks/maintenance was a stopgap
// filter over task recurrence rules; the maintenance module (migration
// 0047) owns the mental model now — completion history, meter cadence,
// assets. Recurring TASKS are still visible in /tasks; upkeep lives at
// /maintenance.
export default function LegacyMaintenanceRedirect() {
  redirect('/maintenance');
}
