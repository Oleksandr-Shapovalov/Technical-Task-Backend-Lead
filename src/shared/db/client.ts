import { PrismaPg } from '@prisma/adapter-pg'
import { config } from '../../config'
import { PrismaClient } from './prisma'

const adapter = new PrismaPg({ connectionString: config.databaseUrl })

export const prisma = new PrismaClient({ adapter })
