import type { Role } from '@/db/schema'

export type Actor =
  | { type: 'user'; id: number; role: Role }
  | { type: 'agent'; id: number }

// Catalog mutations (products, milestones) are admin-only and record who did
// them — an agent principal can never be that "who", so those functions take
// this narrower type instead of the full Actor union.
export type UserActor = Extract<Actor, { type: 'user' }>

export function actorColumns(actor: Actor) {
  return actor.type === 'user'
    ? { actorType: 'user' as const, actorUserId: actor.id, actorTokenId: null }
    : { actorType: 'agent' as const, actorUserId: null, actorTokenId: actor.id }
}
