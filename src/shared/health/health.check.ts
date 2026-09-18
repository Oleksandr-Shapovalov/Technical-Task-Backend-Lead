import { PrismaClient } from '../db/prisma'

export type HealthCheck = () => Promise<void>

export const noopHealthCheck: HealthCheck = async () => undefined

export function prismaHealthCheck(prisma: PrismaClient): HealthCheck {
  return async () => {
    await prisma.$queryRaw`SELECT 1`
  }
}
