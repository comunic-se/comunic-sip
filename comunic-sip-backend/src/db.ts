// Cliente Prisma único (singleton) para o backend.
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
