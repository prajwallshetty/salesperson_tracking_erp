/**
 * Socket.IO room names. Rooms that group "everyone with role X" are namespaced by tenant so one
 * company's events can never reach another company's clients. Per-record rooms use ids that are
 * globally unique UUIDs; super admins may only join those that belong to their own tenant
 * (checked in the socket server).
 */
export const rooms = {
  tenant: (t: string) => `tenant:${t}`,
  admins: (t: string) => `admins:${t}`,
  managers: (t: string) => `managers:${t}`,
  salespersons: (t: string) => `salespersons:${t}`,
  user: (userId: string) => `user:${userId}`,
  manager: (userId: string) => `manager:${userId}`,
  team: (salespersonId: string) => `team:${salespersonId}`,
  salesperson: (salespersonId: string) => `salesperson:${salespersonId}`,
};

/** Parses `team:<id>` / `salesperson:<id>` room names. */
export function parseSalespersonRoom(room: string): { kind: 'team' | 'salesperson'; salespersonId: string } | null {
  const m = /^(team|salesperson):([0-9a-f-]{36})$/i.exec(room);
  return m ? { kind: m[1] as 'team' | 'salesperson', salespersonId: m[2] } : null;
}
